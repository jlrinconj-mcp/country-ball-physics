import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "@/engine/defaults";
import { makeTestCountries } from "@/engine/testing";
import { DEFAULT_DISPLAY } from "@/render/displayOptions";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ countries: vi.fn(), create: vi.fn(), encoder: vi.fn(), after: vi.fn() }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("../../../../scripts/lib/countries", () => ({ createNodeCountryService: () => ({ getAllCountries: mocks.countries }) }));
vi.mock("@/export/server/store", () => ({ createExport: mocks.create, listExports: vi.fn() }));
vi.mock("@/export/server/worker", () => ({ checkEncoder: mocks.encoder, runExportWorker: vi.fn() }));
const countries = makeTestCountries(3);
const body = { config: { ...DEFAULT_CONFIG, seed: "chosen", countries: countries.map(c => c.cca3) }, display: DEFAULT_DISPLAY };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.countries.mockResolvedValue(countries);
  mocks.create.mockResolvedValue({ id: "local-job", status: "queued" });
});
const request = (origin: string, payload = body) => new Request("http://localhost:3001/api/exports", {
  method: "POST", headers: { origin, host: "127.0.0.1:3001", "content-type": "application/json" }, body: JSON.stringify(payload),
});

describe("Play export API", () => {
  it("accepts the browser's HTTP host even when Next's internal URL uses localhost", async () => {
    const response = await POST(request("http://127.0.0.1:3001"));
    expect(response.status).toBe(202);
    expect(mocks.create).toHaveBeenCalledWith(body, countries);
    expect(mocks.after).toHaveBeenCalledOnce();
  });
  it.each(["https://external.example", "null"])("rejects a different or invalid origin: %s", async origin => {
    expect((await POST(request(origin))).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects an invalid configuration before starting an encoder", async () => {
    expect((await POST(request("http://127.0.0.1:3001", { ...body, config: { ...body.config, countries: [] } }))).status).toBe(400);
    expect(mocks.encoder).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
