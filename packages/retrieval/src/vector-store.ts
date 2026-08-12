import { QdrantClient, type Schemas } from "@qdrant/js-client-rest";
import type { ChunkPayload, StoreFilters } from "./types.js";

const collectionName = "code-chunks";
const vectorSize = 1536;

export interface VectorPoint {
  id: string;
  vector: number[];
  payload: ChunkPayload;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  payload: ChunkPayload;
}

const qdrantUrl = process.env.QDRANT_URL ?? "http://localhost:6333";

const payloadValue = (
  value: string
): { match: { value: string } } => ({
  match: { value }
});

export class VectorStore {
  private readonly client: QdrantClient;
  private initialized = false;
  private initialization: Promise<void> | null = null;

  public constructor(url = qdrantUrl) {
    this.client = new QdrantClient({ url });
  }

  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialization ??= (async () => {
      const exists = await this.client.collectionExists(collectionName);
      if (!exists.exists) {
        await this.client.createCollection(collectionName, {
          vectors: {
            size: vectorSize,
            distance: "Cosine"
          }
        });
      }
    })();

    try {
      await this.initialization;
      this.initialized = true;
    } finally {
      this.initialization = null;
    }
  }

  public async upsert(points: VectorPoint[]): Promise<void> {
    await this.initialize();
    await this.client.upsert(collectionName, {
      wait: true,
      points: points.map((point) => ({
        id: point.id,
        vector: point.vector,
        payload: point.payload as unknown as Record<string, unknown>
      }))
    });
  }

  public async search(
    queryVector: number[],
    filters: StoreFilters,
    topK: number
  ): Promise<VectorSearchResult[]> {
    await this.initialize();

    const must: Schemas["Condition"][] = [];
    if (filters.repoId !== undefined) {
      must.push({ key: "repoId", ...payloadValue(filters.repoId) });
    }
    if (filters.language !== undefined) {
      must.push({ key: "language", ...payloadValue(filters.language) });
    }
    if (filters.filePattern !== undefined) {
      must.push({ key: "filePath", match: { text: filters.filePattern } });
    }

    const response = await this.client.search(collectionName, {
      vector: queryVector,
      limit: topK,
      with_payload: true,
      filter: must.length > 0 ? { must } : undefined
    });

    return response
      .filter((point) => typeof point.id === "string" && point.payload !== null)
      .map((point) => ({
        id: String(point.id),
        score: point.score,
        payload: point.payload as unknown as ChunkPayload
      }));
  }
}
