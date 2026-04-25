import {
  FileParsingStubWorker,
  IngestionWorker
} from "@gitpulse/ingestion";

type ManagedWorker = IngestionWorker | FileParsingStubWorker;

let workers: ManagedWorker[] = [];

export const startWorkers = (): void => {
  if (workers.length > 0) {
    return;
  }

  workers = [new IngestionWorker(), new FileParsingStubWorker()];
};

export const shutdownWorkers = async (): Promise<void> => {
  await Promise.all(workers.map((worker) => worker.close()));
  workers = [];
};
