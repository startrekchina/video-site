#!/usr/bin/env bash
set -euo pipefail

# Workers Builds has no ffmpeg; install a pinned build for test fixtures without root access.
# BtbN prunes daily autobuilds after about two weeks; pin a month-end release, which it keeps.
tools="$PWD/.cloudflare/build-tools"
archive="$tools/ffmpeg.tar.xz"
mkdir -p "$tools"
curl --fail --location --silent --show-error --output "$archive" 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-30-13-08/ffmpeg-n8.1.3-9-g29e619e767-linux64-gpl-8.1.tar.xz'
printf '%s  %s\n' '97ce978979194b5cf7e06a5e68020dbdaa7a4f3294c5452b6a1bc347100dbb79' "$archive" | sha256sum --check --status
tar -xJf "$archive" --strip-components=1 -C "$tools"
export PATH="$tools/bin:$PATH"
ffmpeg -version

pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:tools
pnpm build:staging
