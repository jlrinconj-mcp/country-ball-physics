import type { Country } from "@/countries/countryTypes";
import { hashString } from "@/engine/random";

type Sprite = HTMLCanvasElement;

/** Loaded image as far as the atlas cares (DOM image or node-canvas image). */
export type FlagImage = CanvasImageSource & { width: number; height: number };

/**
 * Where canvases and images come from. The browser uses the DOM; Node
 * (thumbnails, batch rendering) plugs in @napi-rs/canvas.
 */
export interface CanvasPlatform {
  createCanvas(width: number, height: number): HTMLCanvasElement;
  loadImage(url: string): Promise<FlagImage | null>;
}

export interface SpriteStyle {
  border: string;
  /** Border width as a fraction of the diameter. */
  borderRatio: number;
  shading: boolean;
}

/**
 * Flags whose key emblem sits near the hoist (canton, stars, hoist triangle).
 * A centre crop would cut it, so the crop shifts toward the hoist instead.
 */
const HOIST_WEIGHTED = new Set(
  (
    "US CN AU NZ TW MY LR UY GR CL TG WS TV FJ CK NU PH CZ CU BS JO SD PS TL GQ DJ ZW MZ ER ST SS KW AE BH QA " +
    "PR KY BM VG FK MS TC SH AI IO GS HM"
  ).split(" "),
);

/** Horizontal crop anchor: 0 = hoist edge, 0.5 = centre. */
export function cropAnchor(cca2: string): number {
  return HOIST_WEIGHTED.has(cca2.toUpperCase()) ? 0.18 : 0.5;
}

/** Decoded flag images, shared across simulations so replays don't refetch. */
const imageCache = new Map<string, Promise<FlagImage | null>>();

function loadBrowserImage(url: string): Promise<FlagImage | null> {
  let pending = imageCache.get(url);
  if (!pending) {
    pending = new Promise((resolve) => {
      const img = new Image();
      // Required so drawing it keeps the canvas exportable (video capture).
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => {
        imageCache.delete(url);
        resolve(null);
      };
      img.src = url;
    });
    imageCache.set(url, pending);
  }
  return pending;
}

export const browserPlatform: CanvasPlatform = {
  createCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
  loadImage: loadBrowserImage,
};

/**
 * Pre-rendered circular flag sprites. Each flag is cover-fitted into a circle
 * (never stretched), shaded and outlined once; per frame the renderer only
 * does a rotated drawImage per ball, which scales to hundreds of balls.
 */
export class FlagAtlas {
  private readonly sprites = new Map<string, Sprite>();
  private readonly images = new Map<string, FlagImage>();
  private style: SpriteStyle;

  constructor(
    style: SpriteStyle,
    private readonly size = 256,
    private readonly platform: CanvasPlatform = browserPlatform,
  ) {
    this.style = style;
  }

  setStyle(style: SpriteStyle): void {
    if (
      style.border === this.style.border &&
      style.borderRatio === this.style.borderRatio &&
      style.shading === this.style.shading
    ) {
      return;
    }
    this.style = style;
    this.sprites.clear();
  }

  /** Sprite for a country; a coloured placeholder until the flag loads. */
  get(country: Country): Sprite {
    let sprite = this.sprites.get(country.cca3);
    if (!sprite) {
      const image = this.images.get(country.cca3) ?? null;
      sprite = this.draw(country, image);
      this.sprites.set(country.cca3, sprite);
    }
    return sprite;
  }

  has(country: Country): boolean {
    return this.images.has(country.cca3);
  }

  /** Load flags, resolving once all are ready or the timeout passes. */
  async preload(countries: Country[], timeoutMs = 5000): Promise<{ loaded: number; failed: number }> {
    let loaded = 0;
    let failed = 0;
    const tasks = countries.map(async (country) => {
      if (this.images.has(country.cca3)) {
        loaded++;
        return;
      }
      const image = await this.platform.loadImage(country.flag.png);
      if (image) {
        this.images.set(country.cca3, image);
        this.sprites.delete(country.cca3);
        loaded++;
      } else {
        failed++;
      }
    });
    await Promise.race([
      Promise.all(tasks),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
    return { loaded, failed };
  }

  private draw(country: Country, image: FlagImage | null): Sprite {
    const size = this.size;
    const canvas = this.platform.createCanvas(size, size);
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const r = size / 2;
    const border = Math.max(2, size * this.style.borderRatio);

    ctx.save();
    ctx.beginPath();
    ctx.arc(r, r, r - border / 2, 0, Math.PI * 2);
    ctx.clip();

    if (image && image.width > 0) {
      // Flags with transparency (Nepal) get a white field.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
      const scale = Math.max(size / image.width, size / image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, (size - w) * cropAnchor(country.cca2), (size - h) / 2, w, h);
    } else {
      const hue = hashString(country.cca3) % 360;
      ctx.fillStyle = `hsl(${hue} 55% 48%)`;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#ffffff";
      ctx.font = `800 ${size * 0.34}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(country.cca2, r, r + size * 0.02);
    }

    if (this.style.shading) {
      const shade = ctx.createRadialGradient(r * 0.7, r * 0.6, r * 0.2, r, r, r);
      shade.addColorStop(0, "rgba(255,255,255,0.18)");
      shade.addColorStop(0.55, "rgba(255,255,255,0)");
      shade.addColorStop(1, "rgba(0,0,0,0.28)");
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, size, size);
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(r, r, r - border / 2, 0, Math.PI * 2);
    ctx.lineWidth = border;
    ctx.strokeStyle = this.style.border;
    ctx.stroke();
    return canvas;
  }
}
