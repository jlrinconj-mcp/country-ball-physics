/** A simple initial visual identity for bolworld's profiles. */
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const manifest = JSON.parse(await readFile(new URL("./manifest.json", import.meta.url), "utf8"));
const folder = fileURLToPath(new URL("../../output/launch-week-01/brand/", import.meta.url));
const family = ["DejaVu Sans", "Liberation Sans", "Arial"].find(name => GlobalFonts.has(name)) ?? "sans-serif";
await mkdir(folder, { recursive: true });

function globe(ctx, x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  const gradient = ctx.createLinearGradient(-r, -r, r, r);
  gradient.addColorStop(0, "#66f4d4");
  gradient.addColorStop(1, "#16a7c7");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = "rgba(7,24,44,0.18)";
  ctx.lineWidth = r * 0.026;
  for (const width of [r * 0.4, r * 0.75]) {
    ctx.beginPath();
    ctx.ellipse(0, 0, width, r, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const height of [-r * 0.45, 0, r * 0.45]) {
    ctx.beginPath();
    ctx.moveTo(-r, height);
    ctx.lineTo(r, height);
    ctx.stroke();
  }
  ctx.restore();
  ctx.font = `800 ${r * 1.8}px "${family}"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#0a152b";
  ctx.fillText("b", 0, -r * 0.05);
  ctx.restore();
}

function background(ctx, w, h) {
  const gradient = ctx.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, "#090f20");
  gradient.addColorStop(1, "#172943");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}

const avatar = createCanvas(1024, 1024);
const avatarCtx = avatar.getContext("2d");
background(avatarCtx, 1024, 1024);
globe(avatarCtx, 512, 512, 355);
await writeFile(`${folder}bolworld-avatar.png`, avatar.toBuffer("image/png"));

for (const [file, width, height, radius, logoX, wordX, wordY, size, subSize] of [
  ["bolworld-youtube-banner.png", 2560, 1440, 110, 800, 970, 712, 140, 43],
  ["bolworld-facebook-cover.png", 1640, 624, 88, 370, 510, 312, 108, 32],
]) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  background(ctx, width, height);
  globe(ctx, logoX, height / 2, radius);
  ctx.font = `800 ${size}px "${family}"`;
  ctx.fillStyle = "#f5f7ff";
  ctx.fillText(manifest.brand.name, wordX, wordY);
  ctx.font = `600 ${subSize}px "${family}"`;
  ctx.fillStyle = "#70dfd5";
  ctx.fillText("YOUR FLAG. PHYSICS DECIDES.", wordX + 4, wordY + size * 0.62);
  await writeFile(`${folder}${file}`, canvas.toBuffer("image/png"));
}
console.log(`Brand drafts: ${folder}`);
