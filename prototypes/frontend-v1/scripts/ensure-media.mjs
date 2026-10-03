// Generates the synthetic test clip on first run; the MP4 is not committed.
import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"

if (!existsSync(new URL("../src/media/test-clip.mp4", import.meta.url))) {
  const r = spawnSync("bash", ["scripts/gen-media.sh"], { stdio: "inherit" })
  if (r.status !== 0) {
    console.error("Failed to generate src/media/test-clip.mp4 (needs bash + ffmpeg on PATH).")
    process.exit(1)
  }
}
