import { setTimeout as sleep } from "node:timers/promises";
import { EXPORT_ROOT, ExportCancelledError, readExportControl } from "./store";

/** Check cancellation during encoder I/O as well as while the frame loop is paused. */
export function monitorExportControl(id: string, root = EXPORT_ROOT) {
  const cancellation = new AbortController();
  let paused = false;
  const cancel = () => cancellation.abort(new ExportCancelledError());
  const poll = async () => {
    try {
      const control = await readExportControl(id, root);
      paused = control.paused;
      if (control.cancelled) cancel();
    } catch { cancel(); }
  };
  const monitor = setInterval(() => { void poll(); }, 100);
  return {
    signal: cancellation.signal,
    cancel,
    isPaused: () => paused,
    dispose: () => clearInterval(monitor),
    async checkpoint() {
      for (;;) {
        cancellation.signal.throwIfAborted();
        const control = await readExportControl(id, root);
        if (control.cancelled) { cancel(); cancellation.signal.throwIfAborted(); }
        if (!control.paused) return;
        await sleep(100, undefined, { signal: cancellation.signal });
      }
    },
  };
}
