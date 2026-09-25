export interface TextStyle {
  size: number;
  weight?: number;
  color: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  /** Shrink the font until the text fits this width. */
  maxWidth?: number;
  stroke?: string;
  strokeWidth?: number;
  shadow?: string;
  letterSpacing?: number;
}

let fontFamily = "system-ui, -apple-system, 'Segoe UI', sans-serif";

export function setFontFamily(family: string): void {
  if (family) fontFamily = family;
}

export function font(size: number, weight = 800): string {
  return `${weight} ${size}px ${fontFamily}`;
}

/** Draw text, auto-fitting to maxWidth. Returns the font size used. */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  style: TextStyle,
): number {
  let size = style.size;
  const weight = style.weight ?? 800;
  ctx.font = font(size, weight);
  if ("letterSpacing" in ctx) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
      `${style.letterSpacing ?? 0}px`;
  }
  if (style.maxWidth) {
    const width = ctx.measureText(text).width;
    if (width > style.maxWidth) {
      size = Math.max(8, Math.floor((size * style.maxWidth) / width));
      ctx.font = font(size, weight);
    }
  }
  ctx.textAlign = style.align ?? "center";
  ctx.textBaseline = style.baseline ?? "alphabetic";
  if (style.shadow) {
    ctx.shadowColor = style.shadow;
    ctx.shadowBlur = size * 0.35;
    ctx.shadowOffsetY = size * 0.06;
  }
  if (style.stroke) {
    ctx.lineJoin = "round";
    ctx.lineWidth = style.strokeWidth ?? size * 0.16;
    ctx.strokeStyle = style.stroke;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = style.color;
  ctx.fillText(text, x, y);
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  return size;
}
