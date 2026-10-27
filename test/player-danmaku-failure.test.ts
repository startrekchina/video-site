import { afterEach, expect, it, vi } from "vitest";
import { Player } from "@/components/site/player";

const state = vi.hoisted(() => ({ effects: [] as (() => void | (() => void))[], refs: [] as { current: unknown }[], message: vi.fn(),
  options: null as unknown, listeners: new Map<string, () => void>(), art: { currentTime: 0, duration: 100, seek: 0, plugins: {},
    on: vi.fn(), once: vi.fn(), play: vi.fn(async () => {}), destroy: vi.fn(), hotkey: { add: vi.fn() }, subtitle: { show: false }, setting: { update: vi.fn() }, notice: { show: "" } } }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useEffect: (effect: () => void | (() => void)) => { state.effects.push(effect); },
  useRef: (current: unknown) => { const ref = { current }; state.refs.push(ref); return ref; }, useState: () => [null, state.message] }));
vi.mock("artplayer", () => ({ default: class { constructor(options: unknown) { state.options = options; return state.art; } } }));
vi.mock("artplayer-plugin-danmuku", () => { throw new Error("Fictional plugin chunk failure"); });
let cleanups: (void | (() => void))[] = [];
afterEach(() => { cleanups.forEach(cleanup => cleanup?.()); vi.unstubAllGlobals(); });

it("starts video, resume and controls even when the optional danmaku module fails to load", async () => {
  vi.stubGlobal("location", { origin: "http://localhost:6120" });
  vi.stubGlobal("document", { addEventListener() {}, removeEventListener() {}, createElement: () => ({ canPlayType: () => "probably" }) });
  vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
  state.art.on.mockImplementation((name: string, handler: () => void) => { state.listeners.set(name, handler); });
  state.art.once.mockImplementation((name: string, handler: () => void) => { state.listeners.set(name, handler); });
  Player({ unitId: "test", source: { qualities: [{ label: "原画", url: "/media/test" }], tracks: [] },
    startSeconds: 30, autoplay: true, progress: { revision: { current: 0 }, interval: 15, duration: 100, onSaved() {} },
    danmaku: { maxLength: 50, lockTime: 5, colors: ["#FFFFFF"], blockWordLimit: 20, blockWordMaxLength: 20 } });
  state.refs[0].current = {};
  cleanups = state.effects.map(effect => effect());
  await vi.dynamicImportSettled(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(state.options).toMatchObject({ url: "http://localhost:6120/media/test", plugins: [] });
  state.listeners.get("ready")!();
  expect(state.art.seek).toBe(30); expect(state.art.play).toHaveBeenCalledOnce();
  expect(state.art.hotkey.add).toHaveBeenCalledTimes(3);
  expect(state.message).toHaveBeenCalledWith({ text: "弹幕加载失败，刷新页面可重试。", reconnect: false });
});
