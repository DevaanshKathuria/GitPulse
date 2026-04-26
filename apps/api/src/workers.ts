import {
  IngestionWorker
} from "@gitpulse/ingestion";
import { FileParsingWorker } from "@gitpulse/parser";

type ManagedWorker = IngestionWorker | FileParsingWorker;

let workers: ManagedWorker[] = [];

export const startWorkers = (): void => {
  if (workers.length > 0) {
    return;
  }

  workers = [new IngestionWorker(), new FileParsingWorker()];
};

export const shutdownWorkers = async (): Promise<void> => {
  await Promise.all(workers.map((worker) => worker.close()));
  workers = [];
};
