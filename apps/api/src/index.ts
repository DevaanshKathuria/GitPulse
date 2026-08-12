import "dotenv/config";
import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response
} from "express";
import type { IncomingMessage, Server } from "node:http";
import { AppError } from "./errors.js";
import { logger } from "./lib/logger.js";
import { register } from "./lib/metrics.js";
import { reposRouter } from "./routes/repos.js";
import { searchRouter } from "./routes/search.js";
import { githubWebhookRouter } from "@gitpulse/ingestion";
import { shutdownWorkers, startWorkers } from "./workers.js";

const app = express();
const requestedPort = Number(process.env.PORT ?? 3001);
const maxPortAttempts = 10;
const allowedOrigins = new Set(
  (process.env.WEB_URL ?? "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
);

app.use((request: Request, response: Response, next: NextFunction) => {
  const origin = request.header("origin");

  if (origin !== undefined && allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }

  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }

  next();
});

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

app.get("/metrics", async (_request: Request, response: Response) => {
  response.setHeader("Content-Type", register.contentType);
  response.status(200).send(await register.metrics());
});

app.use(reposRouter);
app.use(searchRouter);
app.use(githubWebhookRouter);

app.use((_request: Request, _response: Response, next: NextFunction) => {
  next(new AppError("Not found", 404));
});

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const appError =
    error instanceof AppError
      ? error
      : new AppError("Internal server error", 500);

  logger.error(
    {
      statusCode: appError.statusCode,
      error: error instanceof Error ? error.message : "Unknown API error"
    },
    "api request failed"
  );

  response.status(appError.statusCode).json({
    error: appError.message
  });
};

app.use(errorHandler);

const isListenError = (error: unknown): error is Error & { code: string } => {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  );
};

const listen = async (port: number): Promise<Server> => {
  await shutdownWorkers();

  return new Promise((resolve, reject) => {
    const server = app.listen(port);

    server.once("listening", () => {
      resolve(server);
    });

    server.once("error", (error) => {
      reject(error);
    });
  });
};

const startServer = async (): Promise<{ server: Server; port: number }> => {
  for (let attempt = 0; attempt < maxPortAttempts; attempt += 1) {
    const port = requestedPort + attempt;

    try {
      return {
        server: await listen(port),
        port
      };
    } catch (error: unknown) {
      if (isListenError(error) && error.code === "EADDRINUSE") {
        logger.warn({ port, nextPort: port + 1 }, "port already in use");
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    `No available API port found from ${requestedPort} to ${
      requestedPort + maxPortAttempts - 1
    }`
  );
};

const { server, port } = await startServer();

await startWorkers();
logger.info({ port }, "api server listening");

server.on("error", (error) => {
  logger.error({ error: error.message }, "api server error");
  void shutdownWorkers().finally(() => {
    process.exit(1);
  });
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
