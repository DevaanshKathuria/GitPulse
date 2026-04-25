export interface RepoIngestionJob {
  repoId: string;
  githubUrl: string;
  isIncremental: boolean;
}

export interface FileParsingJob {
  repoId: string;
  fileId: string;
  path: string;
  language: string;
}

export interface EmbeddingJob {
  repoId: string;
  fileId: string;
  chunkCount: number;
}

export interface PRAnalysisJob {
  repoId: string;
  prId: string;
  prNumber: number;
}

export interface ContributorAnalysisJob {
  repoId: string;
}
