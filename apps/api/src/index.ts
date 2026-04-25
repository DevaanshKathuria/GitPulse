import "dotenv/config";
import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response
} from "express";
import type { IncomingMessage } from "node:http";
import { AppError } from "./errors.js";
import { reposRouter } from "./routes/repos.js";
import { githubWebhookRouter } from "@gitpulse/ingestion";
import { shutdownWorkers, startWorkers } from "./workers.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(
  express.json({
    verify: (request: IncomingMessage, _response, buffer) => {
      const requestWithRawBody = request as IncomingMessage & {
        rawBody?: Buffer;
      };
      requestWithRawBody.rawBody = Buffer.from(buffer);
    }
  })
);

app.get("/health", (_request: Request, response: Response) => {
  response.status(200).json({ status: "ok" });
});

app.use(reposRouter);
app.use(githubWebhookRouter);

app.use((_request: Request, _response: Response, next: NextFunction) => {
  next(new AppError("Not found", 404));
});

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const appError =
    error instanceof AppError
      ? error
      : new AppError("Internal server error", 500);

  response.status(appError.statusCode).json({
    error: appError.message
  });
};

app.use(errorHandler);

startWorkers();

const server = app.listen(port, () => {
  console.log(`API server listening on port ${port}`);
});

const shutdown = async (): Promise<void> => {
  await shutdownWorkers();
  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
