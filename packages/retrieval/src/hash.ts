import { createHash } from "node:crypto";

export const hashText = (content: string): string => {
  return createHash("sha256").update(content).digest("hex");
};

export const stablePointId = (content: string): string => {
  const hash = createHash("md5").update(content).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32)
  ].join("-");
};
