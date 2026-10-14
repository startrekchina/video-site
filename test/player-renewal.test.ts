import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Player } from "@/components/site/player";
import Watch from "@/routes/watch";
import { TabsTrigger } from "@/components/ui/tabs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { Authorization } from "@/lib/playback.server";
import type { Episode, Work } from "@/lib/catalog";

const state = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[], refs: [] as { current: unknown }[], message: vi.fn(), request: vi.fn(),
  pageState: [] as unknown[], pageIndex: null as number | null, refIndex: 0,
  art: { currentTime: 1234, seek: 0, video: { paused: false }, once: vi.fn(), hotkey: { add: vi.fn() },
    switchUrl: vi.fn(), play: vi.fn(), pause: vi.fn(), destroy: vi.fn(),
    subtitle: { switch: vi.fn(), show: true }, setting: { update: vi.fn() } },
}));
// Run the real effect and renewal controller with only the browser/player boundary replaced.
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useEffect: (effect: () => void | (() => void)) => { state.effects.push(effect); },
  useRef: (current: unknown) => state.refs[state.refIndex++] ??= { current },
  useState: (initial: unknown) => {
    if (state.pageIndex === null) return ["", state.message];
    const index = state.pageIndex++;
    if (!(index in state.pageState)) state.pageState[index] = initial;
    return [state.pageState[index], (value: unknown) => { state.pageState[index] = value; }];
  },
}));
vi.mock("artplayer", () => ({ default: class { constructor() { return state.art; } } }));
vi.mock("react-router", async original => ({ ...await original<typeof import("react-router")>(), UNSAFE_withComponentProps: (component: unknown) => component }));
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
  state.pageState.length = 0; state.pageIndex = null; state.refIndex = 0;
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
  Player({ unitId: "episode-unit", authorization: initial, csrfToken: "fictional-csrf", startSeconds: 0, subtitle: "en", onSubtitleChange, onTracksChange: vi.fn() });
  state.refs[0].current = {};
  cleanups = state.effects.map(effect => effect());
  await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(0);
  return onSubtitleChange;
}
function authorize() {
  return state.request.mockReset().mockImplementation(async () => ({ ...initial, url: "/media/source?token=renewed", expiresAt: Date.now() + 1800000,
    tracks: [{ ...initial.tracks[0], url: "/subtitles/en?token=renewed" }] }));
}

function elements(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(child => elements(child, type));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(node.type === type ? [node] : []), ...elements(node.props.children as ReactNode, type)];
}

it("synchronizes watch page choices with removed and restored tracks without restarting the player", async () => {
  const unit: Episode = { id: "episode-unit", number: 1, seasonNumber: 1, tmdbId: 1, titleZh: "测试片", titleEn: "Test",
    overviewZh: null, overviewEn: null, runtimeMin: null, durationSeconds: 4, still: null, playable: true,
    positionSeconds: 0, completed: false, updatedAt: 0, revision: 0 };
  const work: Work = { slug: "test", kind: "movie", tmdbId: 1, titleZh: "测试片", titleEn: "Test", overviewZh: null,
    overviewEn: null, year: 2026, poster: "", code: "", seasonCount: 0, episodeCount: 1, watchedCount: 0,
    favorite: false, seasons: [], units: [unit] };
  const loaderData = { work, unit, authorization: initial, csrfToken: "fictional-csrf", previous: "", next: "" };
  const page = Watch({ loaderData, params: { id: unit.id }, matches: [
    { id: "root", params: {}, pathname: "/", data: { member: null, catalog: null }, loaderData: { member: null, catalog: null }, handle: undefined },
    { id: "routes/watch", params: { id: unit.id }, pathname: `/watch/${unit.id}`, data: loaderData, loaderData, handle: undefined },
  ] });
  const render = () => {
    state.pageIndex = 0;
    const tree = (page.type as (props: typeof page.props) => ReactNode)(page.props);
    state.pageIndex = null;
    return { player: elements(tree, Player)[0].props as Parameters<typeof Player>[0], tabs: elements(tree, TabsTrigger) };
  };
  let view = render();
  expect(view.tabs.map(tab => tab.props.value)).toEqual(["en", "off"]);
  state.effects.length = 0; state.refs.length = 0; state.refIndex = 0; state.art.video.paused = false;
  Player(view.player); state.refs[0].current = {};
  cleanups = state.effects.map(effect => effect());
  await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(0);
  const switches = state.art.subtitle.switch.mock.calls.length;
  let tracks: Authorization["tracks"] = [];
  const fetch = state.request.mockReset().mockImplementation(async () => ({ ...initial,
    url: "/media/source?token=renewed", expiresAt: Date.now() + 1800000, tracks }));
  await vi.advanceTimersByTimeAsync(1500000);
  view = render();
  expect(view.tabs.map(tab => tab.props.value)).toEqual(["off"]);
  expect(view.player.subtitle).toBe("off"); expect(state.art.subtitle.show).toBe(false);
  expect(state.art.seek).toBe(1234); expect(state.art.destroy).not.toHaveBeenCalled();
  tracks = initial.tracks;
  await vi.advanceTimersByTimeAsync(1500000);
  view = render();
  expect(view.tabs.map(tab => tab.props.value)).toEqual(["en", "off"]);
  expect(view.player.subtitle).toBe("off"); expect(state.art.subtitle.show).toBe(false);
  view.player.onSubtitleChange("en");
  view = render();
  state.effects.length = 0; state.refIndex = 0;
  Player(view.player); state.effects.at(-1)!();
  await vi.advanceTimersByTimeAsync(0);
  expect(state.art.subtitle.show).toBe(true); expect(state.art.subtitle.switch).toHaveBeenCalledTimes(switches + 1);
  expect(fetch).toHaveBeenCalledTimes(2); expect(state.art.pause).not.toHaveBeenCalled();
  expect(state.art.destroy).not.toHaveBeenCalled();
});

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

it("turns off a removed subtitle track while keeping the new video expiry and next renewal", async () => {
  const onSubtitleChange = await mount(), switches = state.art.subtitle.switch.mock.calls.length;
  const fetch = state.request.mockReset().mockImplementation(async () => ({ ...initial, url: "/media/source?token=renewed", expiresAt: Date.now() + 1800000, tracks: [] }));
  await vi.advanceTimersByTimeAsync(1500000);
  expect(onSubtitleChange).toHaveBeenCalledExactlyOnceWith("off");
  expect(state.art.subtitle.show).toBe(false);
  expect(state.art.subtitle.switch).toHaveBeenCalledTimes(switches);
  expect(state.art.setting.update).toHaveBeenLastCalledWith({ name: "subtitle-lang", html: "字幕", selector: [{ html: "关闭", id: "off", default: true }] });
  expect(state.art.seek).toBe(1234);
  await vi.advanceTimersByTimeAsync(300000);
  expect(fetch).toHaveBeenCalledOnce(); expect(state.art.pause).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1200000);
  expect(fetch).toHaveBeenCalledTimes(2); expect(onSubtitleChange).toHaveBeenCalledOnce();
});
