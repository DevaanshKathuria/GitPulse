import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response
} from "express";

export class AppError extends Error {
  public readonly statusCode: number;

  public constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
  }
}

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(express.json());

app.get("/health", (_request: Request, response: Response) => {
  response.status(200).json({ status: "ok" });
});

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

app.listen(port, () => {
  console.log(`API server listening on port ${port}`);
});
