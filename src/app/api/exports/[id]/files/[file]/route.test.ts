import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ directory: vi.fn(), read: vi.fn() }));
vi.mock("@/export/server/store", () => ({ exportDirectory: mocks.directory, readExport: mocks.read }));
let directory: string;
const context = { params: Promise.resolve({ id: "saved-video", file: "part-001.mp4" }) };
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "bolworld-playback-"));
  await writeFile(join(directory, "part-001.mp4"), Buffer.from("0123456789"));
  mocks.directory.mockReturnValue(directory);
  mocks.read.mockResolvedValue({ status: "complete", request: { config: { seed: "test-video" } }, parts: [{ file: "part-001.mp4" }] });
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("saved video playback", () => {
  it("serves inline playable video and preserves the download link", async () => {
    const preview = await GET(new Request("http://localhost/api/exports/saved-video/files/part-001.mp4?preview=1"), context);
    expect(preview.headers.get("Content-Disposition")).toContain("inline;");
    expect(await preview.text()).toBe("0123456789");
    const download = await GET(new Request("http://localhost/api/exports/saved-video/files/part-001.mp4"), context);
    expect(download.headers.get("Content-Disposition")).toContain("attachment;");
    await download.text();
  });
  it.each([
    ["bytes=2-5", "2345", "bytes 2-5/10"],
    ["bytes=7-", "789", "bytes 7-9/10"],
    ["bytes=-3", "789", "bytes 7-9/10"],
    ["bytes=8-999", "89", "bytes 8-9/10"],
  ])("supports seeking with %s", async (range, expected, contentRange) => {
    const response = await GET(new Request("http://localhost/api/video?preview=1", { headers: { range } }), context);
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(contentRange);
    expect(await response.text()).toBe(expected);
  });
  it.each(["bytes=12-", "bytes=-0", "bytes=-", "bytes=1-2,4-6"])("rejects an unusable range: %s", async range => {
    const response = await GET(new Request("http://localhost/api/video", { headers: { range } }), context);
    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */10");
  });
});
