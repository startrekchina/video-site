#!/usr/bin/env bash
set -euo pipefail

# Workers Builds entry for production and Preview builds: `build` is the build command, `deploy` the deploy and Preview command.
# Only the Previews Base build variables set CLOUDFLARE_PREVIEW_BUILD=true and PREVIEW_BRANCH.
mode=production
if [ "${CLOUDFLARE_PREVIEW_BUILD:-}" = true ]; then
  # Every non-production branch push starts a Preview build; only PREVIEW_BRANCH may migrate the Preview database or publish.
  if [ "${WORKERS_CI_BRANCH:-}" != "${PREVIEW_BRANCH:?PREVIEW_BRANCH is required for Preview builds}" ]; then
    echo "Skip: Previews are built only from $PREVIEW_BRANCH."
    exit 0
  fi
  mode=preview
fi

case "${1:-}" in
  build)
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
    pnpm "build:$mode"
    ;;
  deploy)
    node scripts/migrate-remote.mjs "$mode"
    if [ "$mode" = preview ]; then
      pnpm exec cf previews deploy --prebuilt --mode preview
    else
      pnpm exec cf deploy --prebuilt --mode production
    fi
    ;;
  *)
    echo "Usage: scripts/workers-build.sh build|deploy" >&2
    exit 2
    ;;
esac
