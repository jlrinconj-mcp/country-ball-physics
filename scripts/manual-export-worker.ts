import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { monitorExportControl } from "../src/export/server/control";
import { renderVideoExport } from "../src/export/server/render";
import { ExportCancelledError, exportDirectory, isActiveExport, readExport, saveExport } from "../src/export/server/store";
import type { VideoExport } from "../src/export/types";

const id = process.argv[2];
if (!id) throw new Error("Export ID required");
const control = monitorExportControl(id);
process.once("SIGTERM", control.cancel);
process.once("SIGINT", control.cancel);
let video: VideoExport | undefined;
try {
  video = await readExport(id);
  // The job can expire, finish, or be claimed while this process is starting.
  if (isActiveExport(video) && (!video.workerPid || video.workerPid === process.pid)) {
    video.workerPid = process.pid;
    await saveExport(video);
    const directory = exportDirectory(id);
    const countries = JSON.parse(await readFile(join(directory, "countries.json"), "utf8"));
    await renderVideoExport(video, countries, directory, {
      signal: control.signal,
      progress: saveExport,
      checkpoint: control.checkpoint,
      isPaused: control.isPaused,
    });
  }
} catch (error) {
  if (!control.signal.aborted && !(error instanceof ExportCancelledError) && video) {
    video.status = "failed";
    video.error = error instanceof Error ? error.message : String(error);
    delete video.workerPid;
    await saveExport(video).catch(() => {});
    process.exitCode = 1;
  }
} finally {
  control.dispose();
  process.removeListener("SIGTERM", control.cancel);
  process.removeListener("SIGINT", control.cancel);
}
