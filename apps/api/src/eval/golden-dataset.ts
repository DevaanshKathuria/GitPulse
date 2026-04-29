export const goldenDataset: Array<{
  query: string;
  expectedFiles: string[];
  expectedFunctions?: string[];
}> = [
  { query: "JWT token verification", expectedFiles: ["auth", "jwt", "token"] },
  {
    query: "database connection setup",
    expectedFiles: ["db", "database", "prisma", "postgres"]
  },
  {
    query: "rate limiting middleware",
    expectedFiles: ["middleware", "rate", "limit"]
  },
  { query: "error handling middleware", expectedFiles: ["error", "middleware"] },
  { query: "environment variable configuration", expectedFiles: ["config", "env"] },
  { query: "user authentication login", expectedFiles: ["auth", "login", "user"] },
  { query: "file upload handler", expectedFiles: ["upload", "file", "storage"] },
  { query: "email sending service", expectedFiles: ["email", "mail", "notify"] },
  {
    query: "cache invalidation logic",
    expectedFiles: ["cache", "redis", "invalidat"]
  },
  { query: "queue job processing", expectedFiles: ["worker", "queue", "job"] },
  { query: "pagination query parameters", expectedFiles: ["pagination", "page", "limit"] },
  { query: "semantic search endpoint", expectedFiles: ["search", "retrieval"] },
  { query: "GitHub webhook signature verification", expectedFiles: ["webhook", "github"] },
  { query: "health check route", expectedFiles: ["health", "index", "server"] },
  { query: "structured application logging", expectedFiles: ["logger", "log", "pino"] },
  { query: "database migration schema", expectedFiles: ["migration", "schema", "prisma"] },
  { query: "unit test for services", expectedFiles: ["test", "spec"] },
  { query: "API route validation", expectedFiles: ["route", "api", "zod"] },
  { query: "shared TypeScript types", expectedFiles: ["types", "shared"] },
  { query: "utility helper functions", expectedFiles: ["utils", "helper", "lib"] }
];
