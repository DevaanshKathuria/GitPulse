import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTarFiles } from "../../packages/ingestion/src/github-client.js";

const blockSize = 512;

interface TarEntry {
  name: string;
  content: Buffer;
  type?: string;
}

const tarEntry = ({ name, content, type = "0" }: TarEntry): Buffer => {
  const header = Buffer.alloc(blockSize);
  header.write(name, 0, 100, "utf8");
  header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
  header.write(type, 156, 1, "ascii");

  const padding = Buffer.alloc(
    Math.ceil(content.length / blockSize) * blockSize - content.length
  );
  return Buffer.concat([header, content, padding]);
};

const tarArchive = (...entries: TarEntry[]): Buffer => {
  return Buffer.concat([...entries.map(tarEntry), Buffer.alloc(blockSize * 2)]);
};

test("parseTarFiles strips the archive root and preserves file bytes", () => {
  const source = Buffer.from([0x00, 0x7f, 0xff, 0x41]);
  const archive = tarArchive(
    { name: "project-main/src/data.bin", content: source },
    { name: "project-main/src", content: Buffer.alloc(0), type: "5" }
  );

  const files = parseTarFiles(archive);

  assert.equal(files.length, 1);
  assert.equal(files[0]?.path, "src/data.bin");
  assert.equal(files[0]?.size, source.length);
  assert.deepEqual(files[0]?.content, source);
});

test("parseTarFiles handles GNU long filename records", () => {
  const longPath = `project-main/src/${"nested/".repeat(15)}handler.ts`;
  const content = Buffer.from("export const handler = true;\n");
  const archive = tarArchive(
    {
      name: "././@LongLink",
      content: Buffer.from(`${longPath}\0`),
      type: "L"
    },
    { name: "project-main/placeholder", content }
  );

  const files = parseTarFiles(archive);

  assert.equal(files.length, 1);
  assert.equal(files[0]?.path, longPath.replace("project-main/", ""));
  assert.equal(files[0]?.content.toString("utf8"), content.toString("utf8"));
});
