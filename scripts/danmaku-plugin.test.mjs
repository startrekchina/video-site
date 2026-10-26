import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../node_modules/artplayer-plugin-danmuku/dist/artplayer-plugin-danmuku.mjs", import.meta.url), "utf8");
const start = source.indexOf("class Danmuku {"), end = source.indexOf("const lib =", start);
assert.ok(start >= 0 && end > start);
const Danmuku = runInNewContext(`${source.slice(start, end)}; Danmuku`);

test("the editor accepts 50 Unicode code points, limits pasted text, and waits for composition to finish", () => {
  const settingStart = source.indexOf("class Setting {"), settingEnd = source.indexOf("\n}", settingStart) + 2;
  assert.ok(settingStart >= 0 && settingEnd > settingStart);
  const settingSource = source.slice(settingStart, settingEnd);
  const icons = Object.fromEntries([...settingSource.matchAll(/\$[a-zA-Z_][a-zA-Z_0-9]*/g)].map(([name]) => [name, ""]));
  const Setting = runInNewContext(`${settingSource}; Setting`, icons), setting = Object.create(Setting.prototype);
  const input = { value: "" }, events = new Map();
  Object.assign(setting, { template: { $input: input }, danmuku: { option: { ...Danmuku.option, maxLength: 50 } },
    art: { proxy(target, event, handler) { if (target === input) events.set(event, handler); } } });
  assert.match(setting.TEMPLATE, /maxLength="100"/);
  setting.createEvents();
  for (const text of ["😀".repeat(50), "字".repeat(50), "😀字".repeat(25)]) {
    input.value = text; events.get("input")({ isComposing: false }); assert.equal(input.value, text);
    input.value += "😀extra"; events.get("input")({ isComposing: false }); assert.equal(input.value, text);
  }
  input.value = "字".repeat(51); events.get("input")({ isComposing: true }); assert.equal(input.value.length, 51);
  events.get("compositionend")({}); assert.equal(input.value, "字".repeat(50));
});
function instance(items = []) {
  const plugin = Object.create(Danmuku.prototype);
  Object.assign(plugin, { art: { currentTime: 120, emit() {} }, utils: { clamp: (v, min, max) => Math.max(min, Math.min(v, max)) },
    validator() {}, option: { ...Danmuku.option }, queue: items,
    states: { wait: [], ready: [], emit: items.filter(item => item.$state === "emit"), stop: items.filter(item => item.$state === "stop") }, $refs: [], index: 0 });
  return plugin;
}

test("loading a zero-second danmaku preserves its timestamp during resume", async () => {
  const plugin = instance();
  await plugin.emit({ id: "zero", text: "test", time: 0 });
  assert.equal(plugin.queue[0].time, 0);
  await plugin.emit({ id: "live", text: "live" });
  assert.equal(plugin.queue[1].time, 120.5);
});

for (const state of ["emit", "stop"]) test(`filter refresh preserves unrelated ${state} danmaku and restores a hidden item in place`, async () => {
  const item = text => ({ text, time: 118, $state: state, $restTime: 5, $ref: { style: { visibility: "visible" }, dataset: {} } });
  const blocked = item("blocked"), allowed = item("allowed"), plugin = instance([blocked, allowed]);
  const blockedRef = blocked.$ref, allowedRef = allowed.$ref;
  plugin.option.beforeVisible = danmu => danmu.text !== "blocked";
  plugin.reset(true);
  await Promise.resolve();
  assert.equal(blocked.$ref, blockedRef);
  assert.equal(blockedRef.style.visibility, "hidden");
  assert.equal(allowed.$ref, allowedRef);
  assert.equal(allowedRef.style.visibility, "visible");
  assert.equal(allowed.$restTime, 5);
  plugin.option.beforeVisible = () => true;
  plugin.reset(true);
  await Promise.resolve();
  assert.equal(blockedRef.style.visibility, "visible");
  assert.equal(blocked.$restTime, 5);
});

test("ordinary reset still recycles active nodes for the plugin's native layout changes", () => {
  const item = { text: "test", $state: "emit", $ref: { style: {}, dataset: {} } }, plugin = instance([item]);
  plugin.reset();
  assert.equal(item.$ref, null);
  assert.equal(item.$state, "wait");
});
