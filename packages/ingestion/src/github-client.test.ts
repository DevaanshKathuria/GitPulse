import { describe, expect, it } from "vitest";
import { parseTarFiles } from "./github-client.js";

const tarWithFile = (archivePath: string, content: string): Buffer => {
  const header = Buffer.alloc(512);
  header.write(archivePath, 0, 100, "utf8");
  header.write(
    `${Buffer.byteLength(content).toString(8).padStart(11, "0")}\0`,
    124,
    12,
    "ascii"
  );
  header.write("0", 156, 1, "ascii");

  const body = Buffer.from(content, "utf8");
  const padding = Buffer.alloc(Math.ceil(body.length / 512) * 512 - body.length);
  return Buffer.concat([header, body, padding, Buffer.alloc(1024)]);
};

describe("parseTarFiles", () => {
  it("strips GitHub's generated archive root and preserves file content", () => {
    const files = parseTarFiles(
      tarWithFile(
        "DevaanshKathuria-GitPulse-deadbeef/src/index.ts",
        "export const ready = true;\n"
      )
    );

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      path: "src/index.ts",
      size: 27
    });
    expect(files[0]?.content.toString("utf8")).toBe(
      "export const ready = true;\n"
    );
  });
});
