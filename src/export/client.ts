import type { ExportRequest, VideoExport, VideoExportAdapter } from "./types";

export class VideoExportNotFoundError extends Error {
  constructor(message = "Esta grabación fue eliminada. Puedes iniciar otra cuando quieras.") {
    super(message);
    this.name = "VideoExportNotFoundError";
  }
}

async function json(response: Response): Promise<VideoExport> {
  if (response.status === 404) throw new VideoExportNotFoundError();
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "No se pudo exportar el video.");
  return value;
}

export const localVideoExporter: VideoExportAdapter = {
  async create(request: ExportRequest) {
    return json(await fetch("/api/exports", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
    }));
  },
  async get(id, signal) {
    return json(await fetch(`/api/exports/${encodeURIComponent(id)}`, { signal, cache: "no-store" }));
  },
  async setPaused(id, paused) {
    return json(await fetch(`/api/exports/${encodeURIComponent(id)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paused }),
    }));
  },
  async delete(id) {
    const response = await fetch(`/api/exports/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) {
      if (response.status === 404) throw new VideoExportNotFoundError();
      const value = await response.json();
      throw new Error(value.error ?? "No se pudo eliminar el video.");
    }
  },
};

export function exportFileUrl(id: string, file: string, preview = false): string {
  return `/api/exports/${encodeURIComponent(id)}/files/${encodeURIComponent(file)}${preview ? "?preview=1" : ""}`;
}
