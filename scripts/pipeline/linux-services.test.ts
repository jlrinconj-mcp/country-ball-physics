import { expect, it } from "vitest";
import { linuxServices } from "../lib/linuxServices.mjs";

it("renders a persistent five-minute timer and a worker that loads local credentials", () => {
  const units = linuxServices("/home/user/bolworld", "/usr/bin/node", "/usr/bin:/bin");
  expect(units["bolworld-pipeline.timer"]).toContain("OnCalendar=*:0/5");
  expect(units["bolworld-pipeline.timer"]).toContain("Persistent=true");
  expect(units["bolworld-pipeline.service"]).toContain("--env-file-if-exists=/home/user/bolworld/.env.local");
  expect(units["bolworld-pipeline.service"]).toContain("KillMode=control-group");
  expect(units["bolworld-app.service"]).toContain("--hostname 127.0.0.1");
});

it("escapes paths with spaces and systemd specifiers", () => {
  const units = linuxServices("/home/user/My Project%/$work", "/usr/bin/node", "/usr/bin");
  expect(units["bolworld-pipeline.service"]).toContain('WorkingDirectory=/home/user/My Project%%/$work');
  expect(units["bolworld-pipeline.service"]).toContain("$$work/scripts/video-pipeline.ts");
});

it("rejects configuration injection through newlines", () => {
  expect(() => linuxServices("/tmp/project\nExecStart=bad", "/usr/bin/node", "/usr/bin")).toThrow("newline");
});
