import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, PATCH } from "./route";

const mocks = vi.hoisted(() => ({ pause: vi.fn(), remove: vi.fn(), stop: vi.fn(), read: vi.fn() }));
vi.mock("@/export/server/store", () => ({ readExport: mocks.read, setExportPaused: mocks.pause, deleteExport: mocks.remove }));
vi.mock("@/export/server/worker", () => ({ stopExportWorker: mocks.stop }));
const context = { params: Promise.resolve({ id: "local-video" }) };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.pause.mockResolvedValue({ id: "local-video", status: "paused" });
  mocks.remove.mockResolvedValue(undefined);
});
const request = (method: "PATCH" | "DELETE", body?: unknown, origin = "http://127.0.0.1:3001") => new Request("http://localhost:3001/api/exports/local-video", {
  method, headers: { host: "127.0.0.1:3001", origin, "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe("recording controls API", () => {
  it("pauses and resumes a persisted recording", async () => {
    const paused = await PATCH(request("PATCH", { paused: true }), context);
    expect(paused.status).toBe(200);
    expect(await paused.json()).toEqual({ id: "local-video", status: "paused" });
    expect(mocks.pause).toHaveBeenCalledWith("local-video", true);
    await PATCH(request("PATCH", { paused: false }), context);
    expect(mocks.pause).toHaveBeenLastCalledWith("local-video", false);
  });
  it("stops the worker as part of deleting the folder", async () => {
    expect((await DELETE(request("DELETE"), context)).status).toBe(204);
    expect(mocks.remove).toHaveBeenCalledWith("local-video", mocks.stop);
  });
  it("rejects malformed pause controls and cross-origin changes before mutation", async () => {
    expect((await PATCH(request("PATCH", { paused: "yes" }), context)).status).toBe(400);
    expect((await PATCH(request("PATCH", { paused: true }, "http://external.example"), context)).status).toBe(403);
    expect((await DELETE(request("DELETE", undefined, "null"), context)).status).toBe(403);
    expect(mocks.pause).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
