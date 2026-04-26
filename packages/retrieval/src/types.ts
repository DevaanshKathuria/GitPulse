export interface Chunk {
  fileId: string;
  chunkIndex: number;
  content: string;
  metadata: {
    filePath: string;
    language: string;
    functionName?: string;
    startLine?: number;
    endLine?: number;
    type: "function" | "class" | "window";
  };
}

export type EmbeddedChunk = Chunk & {
  embedding: number[] | null;
};

export interface SearchResult {
  chunkId: string;
  fileId: string;
  filePath: string;
  language: string;
  functionName?: string;
  content: string;
  score: number;
  startLine?: number;
  endLine?: number;
  strategy: string;
}

export interface RetrievalFilters {
  language?: string;
  filePattern?: string;
}

export interface StoreFilters extends RetrievalFilters {
  repoId?: string;
}

export type ChunkPayload = Chunk["metadata"] & {
  fileId: string;
  repoId: string;
  chunkIndex: number;
  chunkContent: string;
};
