import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), render: vi.fn(), dispose: vi.fn() }));
vi.mock("../src/export/server/store", async importOriginal => ({
  ...await importOriginal<typeof import("../src/export/server/store")>(),
  readExport: mocks.read,
  saveExport: mocks.save,
}));
vi.mock("../src/export/server/render", () => ({ renderVideoExport: mocks.render }));
vi.mock("../src/export/server/control", () => ({
  monitorExportControl: () => ({ signal: new AbortController().signal, cancel: vi.fn(), checkpoint: vi.fn(), dispose: mocks.dispose }),
}));
const argv = process.argv;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.argv = [...argv.slice(0, 2), "delayed-export"];
});
afterEach(() => { process.argv = argv; });

it.each(["failed", "complete"])("does not restart a %s export when a delayed worker finally starts", async status => {
  const video = { id: "delayed-export", status, error: status === "failed" ? "Interrumpida" : null };
  mocks.read.mockResolvedValue(video);
  await import("./manual-export-worker");
  expect(mocks.render).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(video).toEqual({ id: "delayed-export", status, error: status === "failed" ? "Interrumpida" : null });
  expect(mocks.dispose).toHaveBeenCalledOnce();
});

it("does not claim a recording already owned by another live worker", async () => {
  const video = { id: "delayed-export", status: "recording", workerPid: process.pid + 1 };
  mocks.read.mockResolvedValue(video);
  await import("./manual-export-worker");
  expect(mocks.render).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(video.workerPid).toBe(process.pid + 1);
  expect(mocks.dispose).toHaveBeenCalledOnce();
});
