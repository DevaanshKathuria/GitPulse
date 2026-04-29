export const CacheKeys = {
  architecture: (repoId: string) => `gitpulse:arch:${repoId}`,
  contributors: (repoId: string) => `gitpulse:contrib:${repoId}`,
  busFactor: (repoId: string) => `gitpulse:busf:${repoId}`,
  search: (queryHash: string) => `gitpulse:search:${queryHash}`,
  embedding: (contentHash: string) => `gitpulse:emb:${contentHash}`,
  repoStats: (repoId: string) => `gitpulse:stats:${repoId}`
} as const;
