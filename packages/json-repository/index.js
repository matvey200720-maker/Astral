import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function statePath(fileName) {
  const configuredRoot = String(process.env.MODOVIK_STATE_ROOT || "").trim();
  const directory = configuredRoot
    ? path.resolve(configuredRoot)
    : path.join(os.homedir(), ".modovik");
  return path.join(directory, fileName);
}

export function createJsonRepository({ filePath, defaultValue }) {
  if (!path.isAbsolute(filePath))
    throw new Error("Repository filePath must be absolute.");
  if (typeof defaultValue !== "function")
    throw new Error("defaultValue must be a factory.");
  let mutationQueue = Promise.resolve();

  async function read() {
    try {
      return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return defaultValue();
      if (error instanceof SyntaxError) {
        const repositoryError = new Error(`State file is corrupt: ${filePath}`);
        repositoryError.code = "CORRUPT_STATE";
        repositoryError.cause = error;
        throw repositoryError;
      }
      throw error;
    }
  }

  async function write(value) {
    const directory = path.dirname(filePath);
    await fs.mkdir(directory, { recursive: true });
    const temporaryFile = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryFile, JSON.stringify(value, null, 2), "utf8");
      await fs.rename(temporaryFile, filePath);
    } catch (error) {
      await fs.rm(temporaryFile, { force: true }).catch(() => {});
      throw error;
    }
  }

  function update(mutator) {
    const job = mutationQueue.then(async () => {
      const value = await read();
      const result = await mutator(value);
      await write(value);
      return result;
    });
    mutationQueue = job.catch(() => {});
    return job;
  }

  return Object.freeze({ filePath, read, update, write });
}
