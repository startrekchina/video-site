import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const directory = new URL("../test/fixtures/media/", import.meta.url);
mkdirSync(directory, { recursive: true });
const output = fileURLToPath(new URL("signal-test.mp4", directory));
const result = spawnSync("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24",
  "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
  "-t", "4", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", "-shortest", output,
], { stdio: "inherit" });

if (result.error) {
  console.error("Could not run ffmpeg. Install ffmpeg and ensure it is available on PATH.");
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Generated H.264 + AAC faststart fixture: ${output}`);
