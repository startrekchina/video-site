import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const directory = new URL("../test/fixtures/media/", import.meta.url);
mkdirSync(directory, { recursive: true });
const source = ["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "4"];
// H.264 + AAC MP4 for the low tiers, VP9 + Opus WebM with the index in front for the VP9 tiers (B 6.6).
// Opus padding would stretch the WebM past 4 s, so its audio ends just short and the video sets the same 4 s as the MP4.
const fixtures = [
  ["signal-test.mp4", ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", "-shortest"]],
  ["signal-test.webm", ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-pix_fmt", "yuv420p", "-af", "atrim=end=3.98", "-c:a", "libopus", "-b:a", "64k", "-cues_to_front", "1"]],
];
for (const [name, codecs] of fixtures) {
  const output = fileURLToPath(new URL(name, directory));
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...source, ...codecs, output], { stdio: "inherit" });
  if (result.error) {
    console.error("Could not run ffmpeg. Install ffmpeg and ensure it is available on PATH.");
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`Generated media fixture: ${output}`);
}
