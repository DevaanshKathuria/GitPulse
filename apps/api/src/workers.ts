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

  const [{ IngestionWorker }, { FileParsingWorker }] = await Promise.all([
    import("@gitpulse/ingestion"),
    import("@gitpulse/parser")
  ]);

  workers = [new IngestionWorker(), new FileParsingWorker()];
};

export const shutdownWorkers = async (): Promise<void> => {
  await Promise.all(workers.map((worker) => worker.close()));
  workers = [];
};
