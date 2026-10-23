import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../node_modules/artplayer/dist/artplayer.mjs", import.meta.url), "utf8");
// Run the installed ESM mixins, not a copy of the behavior the pnpm patch changes.
function mixin(name, next) {
  const start = source.indexOf(`function ${name}(art) {`), end = source.indexOf(`function ${next}(art) {`, start);
  assert.ok(start >= 0 && end > start, `ArtPlayer mixin not found: ${name}`);
  return runInNewContext(`(${source.slice(start, end)})`, { def: Object.defineProperty });
}
function player(paused, readyState) {
  const video = { paused, readyState, currentTime: 1234, ended: false, playbackRate: 2 };
  const art = Object.assign(new EventEmitter(), {
    video, template: { $video: video }, aspectRatio: "16:9", notice: { show: "" }, playCalls: 0,
    pause() { video.paused = true; },
    async play() { this.playCalls++; video.paused = false; },
  });
  let url = "/media/original";
  Object.defineProperties(art, {
    currentTime: { get: () => video.currentTime, set: value => { video.currentTime = value; } },
    playbackRate: { get: () => video.playbackRate, set: value => { video.playbackRate = value; } },
    url: { get: () => url, set: value => { url = value; video.currentTime = 0; video.playbackRate = 1; } },
  });
  mixin("playingMix", "playMix")(art);
  mixin("switchMix", "themeMix")(art);
  return art;
}
function loaded(art) {
  art.video.readyState = 3;
  art.emit("video:loadedmetadata");
  art.emit("video:canplay");
}

for (const [name, paused, readyState] of [["playing", false, 4], ["buffering", false, 2], ["paused", true, 4]]) {
  test(`quality switching preserves ${name}, position and playback rate`, async () => {
    const art = player(paused, readyState);
    if (name === "buffering") assert.equal(art.playing, false);
    const switched = art.switchQuality("/media/720p");
    loaded(art);
    await switched;
    assert.equal(art.video.paused, paused);
    assert.equal(art.currentTime, 1234);
    assert.equal(art.playbackRate, 2);
    assert.equal(art.playCalls, paused ? 0 : 1);
  });
}

test("a blocked quality resume rejects instead of leaving the switch pending", async () => {
  const art = player(false, 2), blocked = new DOMException("Fictional blocked resume", "NotAllowedError");
  art.play = async () => { throw blocked; };
  const switched = art.switchQuality("/media/720p");
  loaded(art);
  await assert.rejects(switched, error => error === blocked);
});
