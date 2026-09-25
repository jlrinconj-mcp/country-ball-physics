import type { Viewport } from "@/engine/camera";
import type { DisplayOptions } from "./displayOptions";
import { FORMATS, safeRect } from "./formats";

/** Height of the HUD's top block in output pixels, per 1080 px of short side. */
const HUD_BAND = 240;

/**
 * Camera viewport for a format: the safe area, minus the band the HUD's
 * headline and counter occupy, so the action is never under text.
 */
export function viewportFor(display: DisplayOptions): Viewport {
  const format = FORMATS[display.format];
  const content = safeRect(format);
  if (display.hud) {
    const band = HUD_BAND * (Math.min(format.width, format.height) / 1080);
    content.y += band;
    content.h -= band;
  }
  return { width: format.width, height: format.height, content };
}
