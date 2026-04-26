import { prisma } from "@gitpulse/db";
import {
  getPrAnalysisQueue,
  getRepoIngestionQueue
} from "@gitpulse/queue";
import { Router, type Request, type Response, type Router as ExpressRouter } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

interface GitHubRepositoryPayload {
  html_url?: string;
}

interface GitHubPullRequestPayload {
  number?: number;
}

interface GitHubWebhookPayload {
  repository?: GitHubRepositoryPayload;
  pull_request?: GitHubPullRequestPayload;
  action?: string;
}

export const githubWebhookRouter: ExpressRouter = Router();

githubWebhookRouter.post(
  "/webhooks/github",
  async (request: RequestWithRawBody, response: Response): Promise<void> => {
    const payload = request.body as GitHubWebhookPayload;
    const githubUrl = payload.repository?.html_url;

    if (githubUrl === undefined) {
      response.status(400).json({ error: "Missing repository payload" });
      return;
    }

    const repository = await prisma.repository.findUnique({
      where: { githubUrl }
    });

    if (repository === null || repository.webhookSecret === null) {
      response.status(401).json({ error: "Webhook secret not configured" });
      return;
    }

    const signature = request.header("x-hub-signature-256");
    const rawBody = request.rawBody;

    if (
      signature === undefined ||
      rawBody === undefined ||
      !verifySignature(rawBody, repository.webhookSecret, signature)
    ) {
      response.status(401).json({ error: "Invalid signature" });
      return;
    }

    const event = request.header("x-github-event");

    if (event === "push") {
      await getRepoIngestionQueue().add("ingest-repo", {
        repoId: repository.id,
        githubUrl: repository.githubUrl,
        isIncremental: true
      });
    }

    if (
      event === "pull_request" &&
      (payload.action === "opened" || payload.action === "synchronize") &&
      payload.pull_request?.number !== undefined
    ) {
      await getPrAnalysisQueue().add("analyze-pr", {
        repoId: repository.id,
        prId: String(payload.pull_request.number),
        prNumber: payload.pull_request.number
      });
    }

    response.status(200).json({ status: "accepted" });
  }
);

const verifySignature = (
  rawBody: Buffer,
  secret: string,
  signature: string
): boolean => {
  const expected = `sha256=${createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex")}`;

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  return (
    signatureBuffer.length === expectedBuffer.length &&
    timingSafeEqual(signatureBuffer, expectedBuffer)
  );
};
