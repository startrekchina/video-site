#!/usr/bin/env bash
set -euo pipefail

# Workers Builds has no ffmpeg; install a pinned build for test fixtures without root access.
tools="$PWD/.cloudflare/build-tools"
archive="$tools/ffmpeg.tar.xz"
mkdir -p "$tools"
curl --fail --location --silent --show-error --output "$archive" 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-13-13-05/ffmpeg-n8.1.3-18-g46d899d7a0-linux64-gpl-8.1.tar.xz'
printf '%s  %s\n' 'b3506f47a71a2f8cff8c0775112bf02a8a49035e3994232aa5f218058328e0e7' "$archive" | sha256sum --check --status
tar -xJf "$archive" --strip-components=1 -C "$tools"
export PATH="$tools/bin:$PATH"
ffmpeg -version

pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:tools
pnpm build:staging
