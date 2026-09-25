import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { CanvasPlatform, FlagImage } from "../../src/render/flagAtlas";
import { setFontFamily } from "../../src/render/text";

const images = new Map<string, Promise<FlagImage | null>>();

/** @napi-rs/canvas implementation of the renderer's canvas platform. */
export const nodePlatform: CanvasPlatform = {
  createCanvas: (width, height) => createCanvas(width, height) as unknown as HTMLCanvasElement,
  loadImage(url) {
    let pending = images.get(url);
    if (!pending) {
      pending = fetch(url)
        .then(async (res) => {
          if (!res.ok) return null;
          return (await loadImage(Buffer.from(await res.arrayBuffer()))) as unknown as FlagImage;
        })
        .catch(() => null);
      images.set(url, pending);
    }
    return pending;
  },
};

/** @napi-rs/canvas resolves system fonts on its own; just pick a family. */
export function setupNodeFonts(): void {
  setFontFamily("'Helvetica Neue', Helvetica, Arial, sans-serif");
}

export function createOutputCanvas(width: number, height: number) {
  return createCanvas(width, height);
}
