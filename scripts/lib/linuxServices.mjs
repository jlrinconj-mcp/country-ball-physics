import { dirname, resolve } from "node:path";

function quote(value, dollar = false) {
  if (/[\r\n\0]/.test(value)) throw new Error("Unsupported newline in systemd path");
  const escaped = value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%");
  return `"${dollar ? escaped.replaceAll("$", () => "$$") : escaped}"`;
}

/** Kept separate from installation so service files can be checked without enabling them. */
export function linuxServices(root, nodePath, systemPath) {
  quote(root); // Reject control characters; WorkingDirectory takes an unquoted path.
  if (root.endsWith("\\")) throw new Error("Unsupported trailing backslash in systemd path");
  const path = `${dirname(nodePath)}:${systemPath ?? "/usr/bin:/bin"}`;
  const common = `WorkingDirectory=${root.replaceAll("%", "%%")}\nEnvironment=${quote(`PATH=${path}`)}\nUMask=0077\nNoNewPrivileges=yes\n`;
  return {
    "bolworld-app.service": `[Unit]\nDescription=bolworld local simulator\n\n[Service]\n${common}ExecStart=${quote(nodePath, true)} ${quote(resolve(root, "node_modules/next/dist/bin/next"), true)} start --hostname 127.0.0.1 --port 3000\nRestart=on-failure\nRestartSec=10\n\n[Install]\nWantedBy=default.target\n`,
    "bolworld-pipeline.service": `[Unit]\nDescription=bolworld video generation, publishing and safe cleanup\n\n[Service]\nType=oneshot\n${common}ExecStart=${quote(nodePath, true)} ${quote(`--env-file-if-exists=${resolve(root, ".env.local")}`, true)} --import tsx ${quote(resolve(root, "scripts/video-pipeline.ts"), true)} work\nTimeoutStartSec=2h\nKillMode=control-group\nNice=10\n`,
    "bolworld-pipeline.timer": `[Unit]\nDescription=Review bolworld jobs and expired local videos every five minutes\n\n[Timer]\nOnCalendar=*:0/5\nPersistent=true\nUnit=bolworld-pipeline.service\n\n[Install]\nWantedBy=timers.target\n`,
  };
}
