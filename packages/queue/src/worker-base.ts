import { type Job, Worker } from "bullmq";
import pino from "pino";
import { redisConnection } from "./config.js";
import type { QueueName } from "./queues.js";

const logger = pino({ name: "gitpulse-queue" });

type MetricOutcome = "success" | "failure";

export abstract class WorkerBase<TJobData extends object> {
  protected readonly worker: Worker<TJobData>;
  protected readonly logger = logger;

  protected constructor(queueName: QueueName, concurrency: number) {
    this.worker = new Worker<TJobData>(
      queueName,
      async (job) => this.runJob(job),
      {
        connection: redisConnection,
        concurrency
      }
    );

    this.worker.on("failed", (job, error) => {
      this.logger.error(
        {
          queue: queueName,
          jobId: job?.id,
          error: error.message
        },
        "job failed"
      );
    });

    this.worker.on("error", (error) => {
      this.logger.error(
        {
          queue: queueName,
          error: error.message
        },
        "worker error"
      );
    });
  }

  public async close(): Promise<void> {
    await this.worker.close();
  }

  protected abstract processJob(job: Job<TJobData>): Promise<void>;

  private async runJob(job: Job<TJobData>): Promise<void> {
    const startedAt = Date.now();

    this.logger.info(
      {
        queue: job.queueName,
        jobId: job.id,
        name: job.name,
        attempt: job.attemptsMade + 1
      },
      "job started"
    );

    try {
      await this.processJob(job);
      const durationMs = Date.now() - startedAt;
      this.emitMetrics(job.queueName, durationMs, "success");
      this.logger.info(
        {
          queue: job.queueName,
          jobId: job.id,
          durationMs
        },
        "job completed"
      );
    } catch (error: unknown) {
      const durationMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : "Unknown error";
      this.emitMetrics(job.queueName, durationMs, "failure");
      this.logger.error(
        {
          queue: job.queueName,
          jobId: job.id,
          durationMs,
          error: message
        },
        "job failed during processing"
      );
      throw error;
    }
  }

  private emitMetrics(
    queueName: string,
    durationMs: number,
    outcome: MetricOutcome
  ): void {
    void queueName;
    void durationMs;
    void outcome;
  }
}
