export type RepoStatus = "pending" | "indexing" | "ready" | "failed" | string;
export type SearchStrategy = "hybrid" | "vector" | "bm25";

export interface IngestionJob {
  id: string;
  repoId: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  createdAt: string;
}

export interface Repository {
  id: string;
  githubUrl: string;
  owner: string;
  name: string;
  status: RepoStatus;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  latestIngestionJob?: IngestionJob | null;
  commitCount?: number;
  prCount?: number;
  issueCount?: number;
  fileCount?: number;
}

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

export interface SearchResponse {
  results: SearchResult[];
  strategy: SearchStrategy;
  latencyMs: number;
  cached: boolean;
}

export interface ArchitectureGraph {
  nodes: Array<{ id: string; path: string; functionCount: number; importCount: number }>;
  edges: Array<{ from: string; to: string; type: string }>;
  circularDependencies: string[][];
  unusedFiles: string[];
  stats: {
    totalFiles: number;
    totalEdges: number;
    circularCount: number;
    unusedCount: number;
  };
}

export interface PullRequestSummary {
  id: string;
  number: number;
  title: string;
  author: string;
  status: string;
  riskScore: number | null;
  summary: string | null;
  breakingChanges: unknown[];
}

export interface PullRequestIntelligence {
  id: string;
  number: number;
  title: string;
  author: string;
  status: string;
  summary: string | null;
  riskScore: number | null;
  metadata: unknown;
}

export interface PullRequestList {
  page: number;
  limit: number;
  items: PullRequestSummary[];
}

export interface Contributor {
  login: string;
  commitCount: number;
  linesAdded: number;
  linesRemoved: number;
  ownedFilesCount: number;
}

export interface BusFactor {
  overall: number;
  byDirectory: Record<string, { busFactor: number; owners: string[] }>;
  risks: Array<{
    directory: string;
    risk: "critical" | "high" | "medium";
    reason: string;
  }>;
}

const baseUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").replace(
  /\/$/,
  ""
);

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return (await response.json()) as T;
};

export const api = {
  listRepos: () => request<Repository[]>("/api/v1/repos"),
  getRepo: (repoId: string) => request<Repository>(`/api/v1/repos/${repoId}`),
  createRepo: (githubUrl: string) =>
    request<{ id: string }>("/api/v1/repos", {
      method: "POST",
      body: JSON.stringify({ githubUrl })
    }),
  search: (input: {
    query: string;
    repoId: string;
    strategy: SearchStrategy;
    filters?: { language?: string; filePattern?: string };
    topK?: number;
  }) =>
    request<SearchResponse>("/api/v1/search", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  architecture: (repoId: string) =>
    request<ArchitectureGraph>(`/api/v1/repos/${repoId}/architecture`),
  pullRequests: (repoId: string) =>
    request<PullRequestList>(`/api/v1/repos/${repoId}/prs`),
  pullRequestIntelligence: (repoId: string, prId: string) =>
    request<PullRequestIntelligence | { message: string; jobId?: string }>(
      `/api/v1/repos/${repoId}/prs/${prId}/intelligence`
    ),
  contributors: (repoId: string) =>
    request<Contributor[]>(`/api/v1/repos/${repoId}/contributors`),
  busFactor: (repoId: string) =>
    request<BusFactor | { message: string; jobId?: string }>(
      `/api/v1/repos/${repoId}/bus-factor`
    )
};
