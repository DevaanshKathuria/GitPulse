import {
  FileParsingStubWorker,
  IngestionWorker
} from "@gitpulse/ingestion";

const workers = [new IngestionWorker(), new FileParsingStubWorker()];

export const startWorkers = (): void => {
  void workers;
};

export const shutdownWorkers = async (): Promise<void> => {
  await Promise.all(workers.map((worker) => worker.close()));
};
