/** Linux setup, without downloading generated video archives. */
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { linuxServices } from "./lib/linuxServices.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
function run(binary, args) {
  const result = spawnSync(binary, args, { cwd: root, stdio: "inherit" });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${binary} failed (${result.status})`);
}
if (process.platform !== "linux") throw new Error("This setup targets Linux");
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 9)) throw new Error("Install Node.js 22.9 or newer first");
for (const binary of ["ffmpeg", "ffprobe"]) run(binary, ["-version"]);
run("flock", ["--version"]);
run("npm", ["ci"]);
await copyFile(resolve(root, ".env.example"), resolve(root, ".env.local"), constants.COPYFILE_EXCL).catch(error => {
  if (error.code !== "EEXIST") throw error;
});
await chmod(resolve(root, ".env.local"), 0o600);
run("npm", ["run", "build"]);

if (process.argv.includes("--services")) {
  const directory = resolve(homedir(), ".config/systemd/user");
  await mkdir(directory, { recursive: true });
  for (const [name, contents] of Object.entries(linuxServices(root, process.execPath, process.env.PATH))) {
    // Never overwrite a manually edited unit. Rename/remove it explicitly before reinstalling.
    await writeFile(resolve(directory, name), contents, { flag: "wx", mode: 0o600 }).catch(error => {
      if (error.code !== "EEXIST") throw error;
      console.log(`Keeping existing ${name}`);
    });
  }
  run("systemctl", ["--user", "daemon-reload"]);
  run("systemctl", ["--user", "enable", "--now", "bolworld-app.service", "bolworld-pipeline.timer"]);
  console.log("Ready: http://localhost:3000. Pipeline timer enabled for this Linux user session.");
} else {
  console.log("Setup complete. Start the simulator with npm run start -- --hostname 127.0.0.1.");
}
console.log("Configure account IDs/tokens in .env.local, then run npm run pipeline -- doctor.");
