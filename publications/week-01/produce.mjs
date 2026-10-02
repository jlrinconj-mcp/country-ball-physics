/** Produce bolworld's first three short videos and a landscape episode. */
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

const root = fileURLToPath(new URL("../../", import.meta.url));
const out = resolve(root, "output/launch-week-01");
const manifest = JSON.parse(await readFile(new URL("./manifest.json", import.meta.url), "utf8"));
const fps = manifest.fps;
const results = [];
const posts = [];
const chapterFiles = [];
const fontPath = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const fontFamily = ["Liberation Sans", "DejaVu Sans", "Arial"].find((name) => GlobalFonts.has(name)) ?? "sans-serif";

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal})`);
}

function canvasText(ctx, text, x, y, size, color = "#f5f7ff", weight = 700) {
  ctx.font = `${weight} ${size}px "${fontFamily}"`;
  ctx.fillStyle = color;
  for (const [i, line] of text.split("\n").entries()) ctx.fillText(line, x, y + i * size * 1.25);
}

async function chapterBackground(piece, number, file) {
  const canvas = createCanvas(1920, 1080);
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 1920, 1080);
  gradient.addColorStop(0, "#0a1021");
  gradient.addColorStop(1, "#111e32");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1920, 1080);
  ctx.fillStyle = "#36e2c2";
  ctx.fillRect(80, 84, 60, 7);
  canvasText(ctx, `CHALLENGE ${String(number).padStart(2, "0")} / 03`, 80, 145, 26, "#36e2c2");
  canvasText(ctx, piece.chapterTitle, 80, 245, 43);
  canvasText(ctx, "THE RULES", 80, 430, 23, "#9cadc9");
  canvasText(ctx, piece.ruleLines.join("\n"), 80, 490, 27);
  canvasText(ctx, "PICK YOUR COUNTRY", 80, 780, 24, "#36e2c2");
  canvasText(ctx, "Make your prediction\nbefore the finish.", 80, 833, 27);
  canvasText(ctx, "WATCH FOR", 1360, 230, 25, "#36e2c2");
  canvasText(ctx, piece.watchLines.join("\n"), 1360, 298, 27);
  canvasText(ctx, "REAL PHYSICS", 1360, 640, 25, "#9cadc9");
  canvasText(ctx, "Original simulated challenges.\nEvery replay of the same\nsetup gives the same result.", 1360, 708, 26);
  canvasText(ctx, manifest.brand.name, 1360, 972, 48);
  canvasText(ctx, "GLOBAL PHYSICS CHALLENGES", 80, 988, 21, "#9cadc9");
  await writeFile(file, canvas.toBuffer("image/png"));
}

await mkdir(out, { recursive: true });
await mkdir(resolve(out, "work"), { recursive: true });
await mkdir(resolve(out, "previews"), { recursive: true });

for (const [index, piece] of manifest.pieces.entries()) {
  console.log(`\n${piece.id}: render original`);
  const rawDir = resolve(out, "raw", piece.seed);
  if (!process.argv.includes("--reuse-raw")) {
    run(process.execPath, ["--import", "tsx", "scripts/generate.ts",
      `--mode=${piece.mode}`, `--countries=${piece.countries}`, `--track=${piece.track}`,
      `--seed=${piece.seed}`, `--headline=${piece.headline}`, "--lang=en", "--format=9:16",
      `--frames=${fps}`, "--video", `--out=${resolve(out, "raw")}`]);
  }
  const metadata = JSON.parse(await readFile(resolve(rawDir, "metadata.json"), "utf8"));
  if (metadata.result.decidedBy !== "physics") throw new Error(`${piece.id}: result needs editorial review (${metadata.result.decidedBy})`);
  const source = resolve(rawDir, "video.mp4");
  const duration = metadata.result.ticks / 60;
  const rate = piece.playbackRate;
  const shortFile = resolve(out, `${manifest.brand.name}-${piece.id}.mp4`);
  const ctaFile = resolve(out, "work", `${piece.id}-cta.txt`);
  await writeFile(ctaFile, piece.ctaOnVideo);
  const filter = [
    "[0:v]split=2[gamev][endv]",
    `[gamev]trim=end=${duration},setpts=(PTS-STARTPTS)/${rate}[vg]`,
    `[endv]trim=start=${duration}:end=${duration + 2.5},setpts=PTS-STARTPTS[ve]`,
    "[0:a]asplit=2[gamea][enda]",
    `[gamea]atrim=end=${duration},asetpts=PTS-STARTPTS,atempo=${rate}[ag]`,
    `[enda]atrim=start=${duration}:end=${duration + 2.5},asetpts=PTS-STARTPTS[ae]`,
    "[vg][ag][ve][ae]concat=n=2:v=1:a=1[v][a]",
    `[v]drawtext=fontfile=${fontPath}:textfile=${ctaFile}:expansion=none:fontsize=38:fontcolor=white:x=(w-tw)/2:y=1340:box=1:boxcolor=0x0b1024@0.8:boxborderw=16:enable='gte(t,${duration / rate + 0.5})',drawtext=fontfile=${fontPath}:text=${manifest.brand.name}:expansion=none:fontsize=32:fontcolor=white@0.65:x=80:y=1420,fps=${fps}[vf]`,
    "[a]loudnorm=I=-16:LRA=11:TP=-1.5[af]",
  ].join(";");
  console.log(`${piece.id}: edit short (${rate}x action, normal-speed result)`);
  run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", source,
    "-filter_complex_threads", "1", "-filter_complex", filter, "-map", "[vf]", "-map", "[af]",
    "-c:v", "libx264", "-threads", "2", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", shortFile]);
  run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", "4", "-i", shortFile,
    "-frames:v", "1", resolve(out, `${manifest.brand.name}-${piece.id}-cover.png`)]);

  const background = resolve(out, "work", `${piece.id}-chapter.png`);
  const chapter = resolve(out, "work", `${piece.id}-landscape.mp4`);
  await chapterBackground(piece, index + 1, background);
  console.log(`${piece.id}: full landscape chapter`);
  run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-loop", "1", "-i", background, "-i", source,
    "-filter_complex_threads", "1", "-filter_complex",
    `[1:v]scale=608:1080,fps=${fps}[game];[0:v][game]overlay=x=656:y=0:shortest=1,format=yuv420p[v];[1:a]loudnorm=I=-16:LRA=11:TP=-1.5[a]`,
    "-map", "[v]", "-map", "[a]", "-t", String(duration + 3), "-r", String(fps),
    "-c:v", "libx264", "-threads", "2", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", chapter]);
  chapterFiles.push(chapter);
  const tag = piece.mode === "race" ? "countryrace" : piece.mode === "elimination-drop" ? "plinko" : "lastcountrystanding";
  const base = { id: piece.id, day: piece.day, utcTime: piece.utcTime, status: "ready_unscheduled", file: shortFile, title: piece.title };
  posts.push(
    { ...base, platform: "youtube", caption: `${piece.hook}\n\n${piece.cta}\n\nOriginal physics challenge by ${manifest.brand.name}. Original synthesized sound effects.\n#countryballs #${tag} #shorts` },
    { ...base, platform: "tiktok", caption: `${piece.hook} ${piece.cta} #countryballs #${tag}` },
    { ...base, platform: "instagram", caption: `${piece.hook}\n\n${piece.cta}\n\nA ${manifest.brand.name} physics challenge.\n#countryballs #${tag} #physics` },
    { ...base, platform: "facebook", caption: `${piece.hook}\n\n${piece.cta}\n\nOriginal countryball physics challenge by ${manifest.brand.name}.` },
  );
  results.push({ id: piece.id, seed: piece.seed, sourceSeconds: duration, shortSeconds: duration / rate + 2.5,
    playbackRate: rate, winner: metadata.result.winner, decidedBy: metadata.result.decidedBy,
    fingerprint: metadata.result.fingerprint, originalFile: source, shortFile });
}

const endCanvas = createCanvas(1920, 1080);
const ctx = endCanvas.getContext("2d");
ctx.fillStyle = "#0a1021";
ctx.fillRect(0, 0, 1920, 1080);
canvasText(ctx, "PICK THE NEXT LINEUP", 210, 240, 64, "#36e2c2");
canvasText(ctx, "Comment three countries.\nYour picks could enter the next challenge.", 210, 366, 42);
canvasText(ctx, "TODAY'S WINNERS", 210, 576, 26, "#9cadc9");
canvasText(ctx, results.map((r, i) => `${String(i + 1).padStart(2, "0")}   ${r.winner.name}`).join("\n"), 210, 636, 38);
canvasText(ctx, manifest.brand.name, 1430, 960, 56);
const endPng = resolve(out, "work", "episode-end.png");
const endVideo = resolve(out, "work", "episode-end.mp4");
await writeFile(endPng, endCanvas.toBuffer("image/png"));
run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-loop", "1", "-i", endPng,
  "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "5", "-r", String(fps),
  "-c:v", "libx264", "-threads", "2", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "192k", endVideo]);
chapterFiles.push(endVideo);
const concatFile = resolve(out, "work", "episode-concat.txt");
await writeFile(concatFile, chapterFiles.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n") + "\n");
const episodeFile = resolve(out, `${manifest.brand.name}-episode-01.mp4`);
run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", concatFile,
  "-vf", `setpts=PTS-STARTPTS,fps=${fps}`, "-af", "aresample=async=1:first_pts=0",
  "-c:v", "libx264", "-threads", "2", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", episodeFile]);
run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", "6", "-i", episodeFile,
  "-frames:v", "1", resolve(out, `${manifest.brand.name}-episode-01-cover.png`)]);
const chapterNames = ["Last Country Standing", "Brazil vs France vs Japan", "Plinko Elimination"];
const chapterTimes = [];
let chapterStart = 0;
for (const [index, file] of chapterFiles.slice(0, 3).entries()) {
  const seconds = Math.round(chapterStart);
  chapterTimes.push(`${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")} ${chapterNames[index]}`);
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) throw new Error(`Cannot read chapter duration: ${file}`);
  const duration = Number(probe.stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Invalid chapter duration: ${file}`);
  chapterStart += duration;
}
const episodeTitle = "3 Countryball Challenges: Survival, Racing & Plinko | bolworld #1";
const episodeCaption = "Pick your flag and follow three original physics challenges: last country standing, Brazil vs France vs Japan, and Plinko elimination.\n\nWhich three countries should enter the next episode?\n\nOriginal simulated challenges by bolworld, with on-screen rules and synthesized sound effects.\n\n" + chapterTimes.join("\n");
for (const platform of ["youtube", "facebook"]) posts.push({ id: "04-episode", platform, day: 7, utcTime: "20:00", status: "ready_unscheduled", file: episodeFile, title: episodeTitle, caption: episodeCaption });
await writeFile(resolve(out, "production-report.json"), JSON.stringify({ brand: manifest.brand.name, producedAt: new Date().toISOString(), results, episodeFile }, null, 2) + "\n");
await writeFile(resolve(out, "publication-copies.json"), JSON.stringify(posts, null, 2) + "\n");
await writeFile(resolve(out, "publication-copies.md"), `# ${manifest.brand.name}: textos de publicación\n\nEstado: preparados; no publicados ni programados. Días relativos al lanzamiento después de conectar las cuentas.\n\n` + posts.map(p => `## ${p.id} · ${p.platform} · Día ${p.day}, ${p.utcTime} UTC\n\n**Título:** ${p.title}\n\n${p.caption}\n`).join("\n"));
const columns = ["content_id", "platform", "launch_day", "utc_time", "status", "post_url", "views_24h", "views_72h", "avg_watch_seconds", "completion_pct", "shares", "comments", "new_followers", "top_audience_country", "notes"];
await writeFile(resolve(out, "performance.csv"), columns.join(",") + "\n" + posts.map(p => [p.id,p.platform,p.day,p.utcTime,"ready_unscheduled",...Array(10).fill("")].join(",")).join("\n") + "\n");
console.log(`\nFinished: 3 shorts, 1 landscape episode, 14 publication drafts → ${out}`);
