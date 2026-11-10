// Shared filesystem helpers.
import fs from "node:fs/promises";

// Write JSON atomically: serialize to a temp file in the same directory, then
// rename over the target. A killed process can never leave truncated JSON behind.
export async function atomicWriteJson(path, data, spaces) {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, spaces));
  await fs.rename(tmp, path);
}
