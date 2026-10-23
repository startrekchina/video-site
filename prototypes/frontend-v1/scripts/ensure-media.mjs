// Regenerates the synthetic test clips when any is missing; they are normally committed.
import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"

const clips = ["test-clip.mp4", "test-clip.1080p.mp4", "test-clip.720p.mp4", "test-clip.480p.mp4"]
if (clips.some((f) => !existsSync(new URL(`../src/media/${f}`, import.meta.url)))) {
  const r = spawnSync("bash", ["scripts/gen-media.sh"], { stdio: "inherit" })
  if (r.status !== 0) {
    console.error("Failed to generate src/media/test-clip*.mp4 (needs bash + ffmpeg on PATH).")
    process.exit(1)
  }
}
