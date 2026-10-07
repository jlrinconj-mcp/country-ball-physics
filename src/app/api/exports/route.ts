import { after } from "next/server";
import { createNodeCountryService } from "../../../../scripts/lib/countries";
import { validateExportRequest } from "@/export/configuration";
import { createExport, listExports } from "@/export/server/store";
import { checkEncoder, runExportWorker } from "@/export/server/worker";

export const runtime = "nodejs";
const countries = createNodeCountryService();

export async function GET() {
  return Response.json(await listExports(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  // Next's internal request URL can use localhost while the browser uses 127.0.0.1.
  // Compare against the HTTP host that the browser actually requested.
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (origin) {
    try {
      if (new URL(origin).host !== host) throw new Error("Origin mismatch");
    } catch {
      return Response.json({ error: "Origen no permitido." }, { status: 403 });
    }
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Se requiere JSON." }, { status: 415 });
  const text = await request.text();
  if (text.length > 100_000) return Response.json({ error: "Configuración demasiado grande." }, { status: 413 });
  try {
    const all = await countries.getAllCountries({ includeTerritories: true });
    const selection = validateExportRequest(JSON.parse(text), all);
    await checkEncoder();
    const video = await createExport(selection, all);
    after(() => runExportWorker(video.id));
    return Response.json(video, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo preparar la grabación." }, { status: 400 });
  }
}
