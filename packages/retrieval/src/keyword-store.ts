import { Client } from "@elastic/elasticsearch";
import type { Chunk } from "./types.js";

const indexName = "code-chunks";
const elasticsearchUrl =
  process.env.ELASTICSEARCH_URL ?? "http://localhost:9200";

export interface IndexedChunk extends Chunk {
  id: string;
  repoId: string;
}

export interface KeywordSearchResult {
  id: string;
  score: number;
  chunk: IndexedChunk;
}

interface KeywordDocument {
  fileId: string;
  repoId: string;
  chunkIndex: number;
  content: string;
  filePath: string;
  language: string;
  functionName?: string;
  startLine?: number;
  endLine?: number;
  type: "function" | "class" | "window";
}

export class KeywordStore {
  private readonly client: Client;
  private initialized = false;

  public constructor(node = elasticsearchUrl) {
    this.client = new Client({ node });
  }

  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const exists = await this.client.indices.exists({ index: indexName });
    if (!exists) {
      await this.client.indices.create({
        index: indexName,
        mappings: {
          properties: {
            fileId: { type: "keyword" },
            repoId: { type: "keyword" },
            chunkIndex: { type: "integer" },
            content: { type: "text", analyzer: "english" },
            filePath: { type: "keyword" },
            language: { type: "keyword" },
            functionName: { type: "keyword" }
          }
        }
      });
    }

    this.initialized = true;
  }

  public async index(chunks: IndexedChunk[]): Promise<void> {
    if (chunks.length === 0) {
      return;
    }

    await this.initialize();
    const operations = chunks.flatMap((chunk) => [
      { index: { _index: indexName, _id: chunk.id } },
      {
        fileId: chunk.fileId,
        repoId: chunk.repoId,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        filePath: chunk.metadata.filePath,
        language: chunk.metadata.language,
        functionName: chunk.metadata.functionName,
        startLine: chunk.metadata.startLine,
        endLine: chunk.metadata.endLine,
        type: chunk.metadata.type
      } satisfies KeywordDocument
    ]);

    await this.client.bulk({ operations, refresh: true });
  }

  public async search(
    query: string,
    filters: { repoId?: string; language?: string },
    topK: number
  ): Promise<KeywordSearchResult[]> {
    await this.initialize();

    const filter = [
      ...(filters.repoId !== undefined
        ? [{ term: { repoId: filters.repoId } }]
        : []),
      ...(filters.language !== undefined
        ? [{ term: { language: filters.language } }]
        : [])
    ];

    const response = await this.client.search<KeywordDocument>({
      index: indexName,
      size: topK,
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query,
                fields: ["content"]
              }
            }
          ],
          filter
        }
      }
    });

    return response.hits.hits
      .filter((hit) => hit._source !== undefined && hit._id !== undefined)
      .map((hit) => {
        const source = hit._source as KeywordDocument;
        const id = hit._id ?? "";
        return {
          id,
          score: hit._score ?? 0,
          chunk: {
            id,
            fileId: source.fileId,
            repoId: source.repoId,
            chunkIndex: source.chunkIndex,
            content: source.content,
            metadata: {
              filePath: source.filePath,
              language: source.language,
              functionName: source.functionName,
              startLine: source.startLine,
              endLine: source.endLine,
              type: source.type
            }
          }
        };
      });
  }
}
