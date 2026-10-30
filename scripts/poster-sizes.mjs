import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Display-size copies of each work's main poster; season posters are not shown on pages.
// Keep WIDTHS equal to POSTER_WIDTHS in app/lib/catalog.ts; test/catalog.test.ts fails when a copy is missing.
const WIDTHS = [160, 320, 480];
const directory = new URL("../public/assets/posters/star-trek/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", directory), "utf8"));
for (const width of WIDTHS) mkdirSync(new URL(`w${width}/`, directory), { recursive: true });
for (const { file, season } of manifest) {
  if (season !== null) continue;
  const name = file.replace(/\.jpg$/u, ".webp");
  for (const width of WIDTHS) {
    const output = fileURLToPath(new URL(`w${width}/${name}`, directory));
    const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", fileURLToPath(new URL(name, directory)),
      "-vf", `scale=${width}:-2:flags=lanczos`, "-c:v", "libwebp", "-quality", "75", "-compression_level", "6", output], { stdio: "inherit" });
    if (result.error) {
      console.error("Could not run ffmpeg. Install ffmpeg with libwebp and ensure it is available on PATH.");
      process.exit(1);
    }
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  console.log(`Sized poster: ${name}`);
}
