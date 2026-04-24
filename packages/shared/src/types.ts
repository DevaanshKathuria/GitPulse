export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface Repository {
  id: string;
  githubUrl: string;
  owner: string;
  name: string;
  status: string;
  lastSyncedAt: Date | null;
  webhookSecret: string | null;
  metadata: JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Commit {
  id: string;
  repoId: string;
  sha: string;
  message: string;
  author: string;
  timestamp: Date;
  filesChanged: JsonValue | null;
  createdAt: Date;
}

export interface PullRequest {
  id: string;
  repoId: string;
  number: number;
  title: string;
  body: string | null;
  author: string;
  status: string;
  diff: string | null;
  riskScore: number | null;
  summary: string | null;
  metadata: JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Issue {
  id: string;
  repoId: string;
  number: number;
  title: string;
  body: string | null;
  labels: JsonValue | null;
  cluster: string | null;
  createdAt: Date;
}

export interface CodeFile {
  id: string;
  repoId: string;
  path: string;
  language: string | null;
  content: string | null;
  lastModified: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ASTNode {
  id: string;
  fileId: string;
  type: string;
  name: string | null;
  startLine: number | null;
  endLine: number | null;
  metadata: JsonValue | null;
  createdAt: Date;
}

export interface DependencyEdge {
  id: string;
  repoId: string;
  fromFile: string;
  toFile: string;
  type: string;
}

export interface Contributor {
  id: string;
  repoId: string;
  login: string;
  commitCount: number;
  linesAdded: number;
  linesRemoved: number;
  ownedFiles: JsonValue | null;
  metadata: JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmbeddingChunk {
  id: string;
  fileId: string;
  chunkIndex: number;
  content: string;
  qdrantPointId: string | null;
  metadata: JsonValue | null;
  createdAt: Date;
}

export interface IngestionJob {
  id: string;
  repoId: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
  metadata: JsonValue | null;
  createdAt: Date;
}

export interface RetrievalLog {
  id: string;
  query: string;
  repoId: string | null;
  results: JsonValue | null;
  latencyMs: number | null;
  strategy: string | null;
  createdAt: Date;
}
