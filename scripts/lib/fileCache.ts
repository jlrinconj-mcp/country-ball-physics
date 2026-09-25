import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isDataset, type CountryCacheStore } from "../../src/countries/countryCache";

/** Disk cache for CLI runs, so batch generation survives API outages. */
export function createFileCache(path: string): CountryCacheStore {
  return {
    async read() {
      try {
        const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
        return isDataset(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    async write(dataset) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(dataset));
    },
  };
}
