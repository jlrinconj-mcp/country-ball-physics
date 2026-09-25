"use client";

import { useEffect, useRef } from "react";
import { FORMATS, type VideoFormat } from "@/render/formats";
import type { SimulationController } from "@/runtime/SimulationController";

/**
 * Hosts the simulation canvas and keeps it letterboxed to the output format.
 * Sizing is applied imperatively so resizing never re-renders React.
 */
export function SimulatorViewport({
  controller,
  format,
}: {
  controller: SimulationController;
  format: VideoFormat;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    controller.attach(canvas);
    return () => controller.detach();
  }, [controller]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const spec = FORMATS[format];
    const fit = () => {
      const { width, height } = wrap.getBoundingClientRect();
      const scale = Math.min(width / spec.width, height / spec.height);
      const w = Math.max(1, Math.floor(spec.width * scale));
      const h = Math.max(1, Math.floor(spec.height * scale));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      controller.resize(w, window.devicePixelRatio || 1);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [controller, format]);

  return (
    <div ref={wrapRef} className="relative flex min-h-0 flex-1 items-center justify-center">
      <canvas
        ref={canvasRef}
        className="rounded-xl shadow-2xl shadow-black/60 ring-1 ring-white/10"
        aria-label="Simulation preview"
      />
    </div>
  );
}
