/** Preferred containers, best first. MP4 uploads everywhere; WebM is the fallback. */
const MIME_TYPES = [
  "video/mp4;codecs=avc1.640028,mp4a.40.2",
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

/** Records a canvas (plus optional audio) with MediaRecorder. */
export class CanvasRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  readonly mimeType: string;

  static supported(): boolean {
    return typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement !== "undefined" && "captureStream" in HTMLCanvasElement.prototype;
  }

  constructor() {
    this.mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
  }

  get extension(): string {
    return this.mimeType.startsWith("video/mp4") ? "mp4" : "webm";
  }

  start(canvas: HTMLCanvasElement, fps: number, audio?: MediaStream): void {
    const stream = canvas.captureStream(fps);
    audio?.getAudioTracks().forEach((track) => stream.addTrack(track));
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, {
      mimeType: this.mimeType || undefined,
      videoBitsPerSecond: 12_000_000,
    });
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start(1000);
  }

  stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder) return Promise.resolve(new Blob());
    return new Promise((resolve) => {
      recorder.onstop = () => {
        recorder.stream.getTracks().forEach((track) => track.stop());
        resolve(new Blob(this.chunks, { type: this.mimeType || "video/webm" }));
        this.recorder = null;
      };
      recorder.stop();
    });
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
