import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { PassThrough, Writable } from "node:stream";
import { expect, it, vi } from "vitest";
import { watchEncoder, writeEncoderFrame } from "./encoder";

it("reports FFmpeg's diagnostic instead of an early EPIPE from its input", async () => {
  const input = new Writable({
    highWaterMark: 1,
    write(_chunk, _encoding, callback) {
      callback(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    },
  });
  input.on("error", () => {});
  const stderr = new PassThrough();
  const child = Object.assign(new EventEmitter(), { stdin: input, stderr, kill: vi.fn() }) as unknown as ChildProcess;
  const closed = watchEncoder(child);
  const writing = writeEncoderFrame(child, Buffer.alloc(10), closed);
  // The input error arrives before the process's final stderr and close.
  await new Promise<void>(resolve => setImmediate(resolve));
  stderr.write("Encoder configuration is invalid");
  child.emit("close", 1);
  await expect(writing).rejects.toThrow("Encoder configuration is invalid");
  expect(child.kill).not.toHaveBeenCalled();
});
