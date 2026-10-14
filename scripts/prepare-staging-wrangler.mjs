import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBuildOutput } from "@cloudflare/build-output-utils";
import { convertToWranglerConfig } from "@cloudflare/config";

export function stagingWranglerConfig(build, directory) {
  const worker = build.workers.default;
  if (build.rootConfig.buildContext?.mode !== "staging" || worker.config.name !== "stcn-video-site-staging"
    || worker.config.env?.APP_ENV?.value !== "staging" || Object.keys(build.workers).length !== 1 || build.containers.length !== 0) {
    throw new Error("Expected a single staging Worker build; refusing to prepare another deployment target.");
  }
  if (!worker.bundleDir || !worker.assetsDir || !worker.config.manifest) throw new Error("Staging build is missing its bundle, assets or manifest.");
  if (Object.values(worker.config.manifest.modules).some(module => module.type !== "esm")) {
    throw new Error("Staging build contains unsupported module types; review the Wrangler adapter.");
  }
  const config = convertToWranglerConfig({ ...build.rootConfig, worker: worker.config, containers: [] });
  const portable = path => relative(directory, path).replaceAll("\\", "/");
  config.main = portable(join(worker.bundleDir, worker.config.manifest.mainModule));
  config.assets = { ...config.assets, directory: portable(worker.assetsDir) };
  // Preserve the framework's split modules instead of bundling or rebuilding them.
  config.no_bundle = true;
  config.find_additional_modules = true;
  config.preserve_file_names = true;
  config.rules = [{ type: "ESModule", globs: ["**/*.js"] }];
  config.send_metrics = false;
  return config;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve(".cloudflare/wrangler-staging");
  const config = stagingWranglerConfig(await readBuildOutput(process.cwd()), directory);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "wrangler.json"), JSON.stringify(config, null, 2));
  console.log("Prepared staging Wrangler config from validated Build Output.");
}
