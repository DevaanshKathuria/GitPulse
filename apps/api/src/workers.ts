import { isRedisAvailable } from "@gitpulse/queue";

type ManagedWorker = {
  close: () => Promise<void>;
};

let workers: ManagedWorker[] = [];

export const startWorkers = async (): Promise<void> => {
  if (workers.length > 0) {
    return;
  }

  if (!(await isRedisAvailable())) {
    console.warn(
      "Redis is not reachable; queue workers are disabled for this API process."
    );
    return;
  }

  const [
    { IngestionWorker },
    { FileParsingWorker },
    { EmbeddingWorker },
    { PRAnalysisWorker },
    { ContributorAnalysisWorker }
  ] = await Promise.all([
    import("@gitpulse/ingestion"),
    import("@gitpulse/parser"),
    import("@gitpulse/retrieval"),
    import("./workers/pr-analysis-worker.js"),
    import("./workers/contributor-analysis-worker.js")
  ]);

  workers = [
    new IngestionWorker(),
    new FileParsingWorker(),
    new EmbeddingWorker(),
    new PRAnalysisWorker(),
    new ContributorAnalysisWorker()
  ];
};

export const shutdownWorkers = async (): Promise<void> => {
  await Promise.all(workers.map((worker) => worker.close()));
  workers = [];
};
