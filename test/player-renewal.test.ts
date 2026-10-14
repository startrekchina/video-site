import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Player } from "@/components/site/player";
import type { Authorization } from "@/lib/playback.server";

const state = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[], refs: [] as { current: unknown }[], message: vi.fn(), request: vi.fn(),
  art: { currentTime: 1234, seek: 0, video: { paused: false }, once: vi.fn(), hotkey: { add: vi.fn() },
    switchUrl: vi.fn(), play: vi.fn(), pause: vi.fn(), destroy: vi.fn(),
    subtitle: { switch: vi.fn(), show: true }, setting: { update: vi.fn() } },
}));
// Run the real effect and renewal controller with only the browser/player boundary replaced.
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useEffect: (effect: () => void | (() => void)) => { state.effects.push(effect); },
  useRef: (current: unknown) => { const ref = { current }; state.refs.push(ref); return ref; },
  useState: () => ["", state.message],
}));
vi.mock("artplayer", () => ({ default: class { constructor() { return state.art; } } }));
vi.mock("@/components/ui/button", () => ({ Button: () => null }));
vi.mock("@/lib/playback-client", async original => ({
  ...await original<typeof import("@/lib/playback-client")>(), fetchAuthorization: state.request,
}));

const initial: Authorization = { url: "/media/source?token=initial", expiresAt: 1800000,
  tracks: [{ id: "en", language: "en", displayName: "English", url: "/subtitles/en?token=initial" }] };
let cleanups: (void | (() => void))[] = [];
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(0); vi.clearAllMocks();
  state.effects.length = 0; state.refs.length = 0; state.art.seek = 0;
  state.art.switchUrl.mockReset().mockResolvedValue(undefined);
  state.art.play.mockReset().mockResolvedValue(undefined);
  state.art.subtitle.switch.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("location", { origin: "http://localhost:6120" });
});
afterEach(() => {
  cleanups.forEach(cleanup => cleanup?.()); cleanups = [];
  vi.useRealTimers(); vi.unstubAllGlobals();
});
async function mount(paused = false) {
  state.art.video.paused = paused;
  const onSubtitleChange = vi.fn();
  Player({ unitId: "episode-unit", authorization: initial, csrfToken: "fictional-csrf", startSeconds: 0, subtitle: "en", onSubtitleChange });
  state.refs[0].current = {};
  cleanups = state.effects.map(effect => effect());
  await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(0);
  return onSubtitleChange;
}
function authorize() {
  return state.request.mockReset().mockImplementation(async () => ({ ...initial, url: "/media/source?token=renewed", expiresAt: Date.now() + 1800000,
    tracks: [{ ...initial.tracks[0], url: "/subtitles/en?token=renewed" }] }));
}

it.each([{ paused: false, blocked: false }, { paused: true, blocked: false }, { paused: false, blocked: true }])(
  "keeps new expiry and subtitle selection after subtitle failure ($paused/$blocked)", async ({ paused, blocked }) => {
    const onSubtitleChange = await mount(paused), fetch = authorize();
    state.art.subtitle.switch.mockRejectedValue(new TypeError("Fictional subtitle connection failure"));
    if (blocked) state.art.play.mockRejectedValue(new Error("Fictional autoplay restriction"));
    await vi.advanceTimersByTimeAsync(1500000);
    expect(state.art.switchUrl).toHaveBeenCalledWith("http://localhost:6120/media/source?token=renewed");
    expect(state.art.seek).toBe(1234); expect(onSubtitleChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state.art.pause).toHaveBeenCalledTimes(paused ? 1 : 0);
    expect(state.message.mock.calls.at(-1)?.[0]).toContain("字幕暂时无法加载");
    if (blocked) expect(state.message.mock.calls.at(-1)?.[0]).toContain("浏览器未允许自动恢复");
    await vi.advanceTimersByTimeAsync(1200000);
    expect(fetch).toHaveBeenCalledTimes(2);
  },
);

it("keeps video switch failures in bounded renewal retries and pauses at the original deadline", async () => {
  await mount(); const fetch = authorize();
  state.art.switchUrl.mockRejectedValue(new Error("Fictional video connection failure"));
  await vi.advanceTimersByTimeAsync(1550000);
  expect(fetch).toHaveBeenCalledTimes(4); expect(state.art.pause).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(250000);
  expect(state.art.pause).toHaveBeenCalledOnce();
  expect(state.message.mock.calls.at(-1)?.[0]).toContain("到期");
});
