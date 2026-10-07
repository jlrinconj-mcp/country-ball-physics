import { deleteExport, readExport, setExportPaused } from "@/export/server/store";
import { stopExportWorker } from "@/export/server/worker";

export const runtime = "nodejs";

function validateOrigin(request: Request): Response | undefined {
  const origin = request.headers.get("origin");
  if (!origin) return;
  try {
    const host = request.headers.get("host") ?? new URL(request.url).host;
    if (new URL(origin).host === host) return;
  } catch {}
  return Response.json({ error: "Origen no permitido." }, { status: 403 });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json(await readExport(id), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "No se encontró la exportación." }, { status: 404 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const forbidden = validateOrigin(request);
  if (forbidden) return forbidden;
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Se requiere JSON." }, { status: 415 });
  const text = await request.text();
  if (text.length > 1000) return Response.json({ error: "Solicitud demasiado grande." }, { status: 413 });
  let paused: boolean;
  try {
    const value = JSON.parse(text);
    if (typeof value?.paused !== "boolean") throw new Error();
    paused = value.paused;
  } catch {
    return Response.json({ error: "Indica si la grabación debe pausarse." }, { status: 400 });
  }
  try {
    const { id } = await context.params;
    return Response.json(await setExportPaused(id, paused), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "No se encontró la exportación." }, { status: 404 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const forbidden = validateOrigin(request);
  if (forbidden) return forbidden;
  try {
    const { id } = await context.params;
    await deleteExport(id, stopExportWorker);
    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: "No se pudo eliminar la exportación." }, { status: 404 });
  }
}
