import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Player, noticeToast } from "@/components/site/player";
import Watch from "@/routes/watch";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { PlaybackSource } from "@/lib/playback.server";
import type { Episode, Work } from "@/lib/catalog";
import { settings } from "@/lib/settings.server";
import { forgetDanmaku, setBlockedWords } from "@/lib/danmaku-client";
import type { Option as DanmakuOption } from "artplayer-plugin-danmuku";

type Handler = (...args: unknown[]) => unknown;
const state = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[], refs: [] as { current: unknown }[], message: vi.fn(), options: null as unknown,
  pageState: [] as unknown[], pageIndex: null as number | null, refIndex: 0, handlers: new Map<string, Handler[]>(),
  location: { state: null as unknown }, navigation: "POP", danmaku: null as unknown,
  art: { currentTime: 1234, duration: 4000, seek: 0, url: "", destroy: vi.fn(), hotkey: { add: vi.fn() },
    on: vi.fn(), once: vi.fn(), play: vi.fn(), switchQuality: vi.fn(), subtitle: { switch: vi.fn(), show: false }, setting: { update: vi.fn() }, notice: { show: "" },
    width: 1200, fullscreen: false, fullscreenWeb: false, isFocus: false, template: { $controlsCenter: { name: "controls-center" }, $player: { contains: vi.fn((_node: unknown) => false) } },
    plugins: { artplayerPluginDanmuku: { reset: vi.fn(), mount: vi.fn(), option: {} as Record<string, unknown>, isHide: false } } },
}));
// Run the real effects and player wiring with only the browser/ArtPlayer boundary replaced.
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
vi.mock("artplayer", () => ({ default: class { constructor(options: unknown) { state.options = options; return state.art; } } }));
vi.mock("artplayer-plugin-danmuku", () => ({ default: (option: unknown) => { state.danmaku = option; return () => state.art.plugins.artplayerPluginDanmuku; } }));
vi.mock("react-router", async original => ({ ...await original<typeof import("react-router")>(), UNSAFE_withComponentProps: (component: unknown) => component,
  useLocation: () => state.location, useNavigationType: () => state.navigation }));
vi.mock("@/components/ui/button", () => ({ Button: () => null }));

const h264 = 'video/mp4; codecs="avc1.640028, mp4a.40.2"', vp9uhd = 'video/mp4; codecs="vp09.00.51.08, mp4a.40.2"', vp9hd = 'video/mp4; codecs="vp09.00.41.08, mp4a.40.2"';
const source: PlaybackSource = { qualities: [{ label: "720p", url: "/media/source", type: h264 }], tracks: [{ id: "en", language: "en", displayName: "English", url: "/subtitles/en" }] };
const danmaku = { maxLength: settings.danmaku.maxLength, lockTime: settings.rateLimits.danmaku.minInterval, colors: [...settings.danmaku.colors],
  blockWordLimit: settings.danmaku.blockWordLimit, blockWordMaxLength: settings.danmaku.blockWordMaxLength };
const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
let cleanups: (void | (() => void))[] = [], blobs = 0;
const page = { visibilityState: "visible", listeners: new Map<string, () => void>(), undecodable: new Set<string>() };
const emit = (event: string) => Promise.all((state.handlers.get(event) ?? []).map(handler => handler()));
beforeEach(() => {
  vi.clearAllMocks();
  state.effects.length = 0; state.refs.length = 0; state.refIndex = 0; state.pageState.length = 0; state.pageIndex = null;
  state.handlers.clear(); state.location = { state: null }; state.navigation = "POP"; state.art.currentTime = 1234; state.art.url = ""; state.art.subtitle.show = false;
  const listen = (event: string, handler: Handler) => { state.handlers.set(event, [...state.handlers.get(event) ?? [], handler]); };
  state.art.on.mockImplementation(listen); state.art.once.mockImplementation(listen);
  state.art.subtitle.switch.mockReset().mockResolvedValue(undefined);
  state.art.play.mockReset().mockResolvedValue(undefined);
  state.art.switchQuality.mockReset().mockResolvedValue(undefined);
  state.art.width = 1200; state.art.fullscreen = false; state.art.fullscreenWeb = false; state.danmaku = null;
  Object.assign(state.art.plugins.artplayerPluginDanmuku, { option: {}, isHide: false });
  fetch.mockReset().mockImplementation(async () => new Response("WEBVTT\n\n"));
  blobs = 0;
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("location", { origin: "http://localhost:6120" });
  page.visibilityState = "visible"; page.listeners.clear(); page.undecodable.clear();
  const on = (type: string, handler: () => void) => { page.listeners.set(type, handler); };
  vi.stubGlobal("document", { get visibilityState() { return page.visibilityState; }, addEventListener: on, removeEventListener: vi.fn(),
    createElement: () => ({ canPlayType: (type: string) => page.undecodable.has(type) ? "" : "probably" }) });
  vi.stubGlobal("window", { addEventListener: on, removeEventListener: vi.fn() });
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => `blob:fictional-${++blobs}`), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanups.forEach(cleanup => cleanup?.()); cleanups = []; vi.unstubAllGlobals(); });

async function mount(props: Partial<Parameters<typeof Player>[0]> = {}) {
  Player({ unitId: "episode-unit", source, startSeconds: 0, progress: { revision: { current: 0 }, interval: 15, duration: null, onSaved: vi.fn() }, danmaku, ...props });
  state.refs[0].current = {};
  cleanups = state.effects.map(effect => effect());
  await vi.dynamicImportSettled(); await new Promise(resolve => setTimeout(resolve, 0));
  if (!props.startSeconds) await emit("ready");
}
// Subtitles are chosen only in the player's own settings menu.
const choose = (id: string) => (state.options as { settings: { onSelect(item: { id: string; html: string }): string }[] }).settings[0].onSelect({ id, html: id });
function elements(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(child => elements(child, type));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(node.type === type ? [node] : []), ...elements(node.props.children as ReactNode, type)];
}

it("plays the fixed session-authorized source and loads the chosen subtitle from a checked response", async () => {
  await mount();
  expect(state.options).toMatchObject({ url: "http://localhost:6120/media/source" });
  expect(fetch).toHaveBeenCalledExactlyOnceWith("http://localhost:6120/subtitles/en", { credentials: "same-origin", cache: "no-store" });
  expect(state.art.subtitle.switch).toHaveBeenCalledWith("blob:fictional-1", { name: "English", type: "vtt", escape: true });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fictional-1");
  expect(state.art.subtitle.show).toBe(true);
  expect(state.message).not.toHaveBeenCalled();
});

it("removes a missing subtitle from the menu but keeps a transient failure selectable", async () => {
  fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
  await mount();
  expect(state.art.subtitle.switch).not.toHaveBeenCalled(); expect(state.art.subtitle.show).toBe(false);
  expect(state.art.setting.update).toHaveBeenLastCalledWith({ name: "subtitle-lang", html: "字幕", selector: [{ html: "关闭", id: "off", default: true }] });
  expect(state.message).toHaveBeenLastCalledWith({ text: expect.stringContaining("已从字幕选项中移除"), reconnect: false });
  cleanups.forEach(cleanup => cleanup?.()); state.effects.length = 0; state.refs.length = 0; state.refIndex = 0; vi.clearAllMocks();
  fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
  await mount();
  expect(state.art.setting.update).toHaveBeenLastCalledWith({ name: "subtitle-lang", html: "字幕", selector: [{ html: "English", id: "en", default: false }, { html: "关闭", id: "off", default: true }] });
  expect(state.message).toHaveBeenLastCalledWith({ text: expect.stringContaining("请再次选择该字幕"), reconnect: false });
});

it("classifies each failure once and never retries the video by itself", async () => {
  const { default: Artplayer } = await import("artplayer") as unknown as { default: { RECONNECT_TIME_MAX?: number } };
  await mount(); fetch.mockClear(); state.message.mockClear();
  expect(Artplayer.RECONNECT_TIME_MAX).toBe(0);
  // A lost sign-in offers signing in again; reconnecting would only fail with 401 again.
  for (const [reply, text, action] of [
    [async () => new Response(null, { status: 401 }), "登录已失效", { reconnect: false, login: true }],
    [async () => new Response(null, { status: 404 }), "片源暂时无法播放", { reconnect: true }],
    [async () => { throw new TypeError("offline"); }, "播放连接中断", { reconnect: true }],
  ] as const) {
    fetch.mockImplementationOnce(reply);
    await Promise.all([emit("video:error"), emit("video:error")]); await emit("video:error");
    expect(fetch).toHaveBeenCalledExactlyOnceWith("http://localhost:6120/media/source", { method: "HEAD", credentials: "same-origin", cache: "no-store" });
    expect(state.message).toHaveBeenLastCalledWith({ text: expect.stringContaining(text), ...action });
    // Cached leading bytes can fire canplay without a reconnect; that must not seek into the failed range again.
    state.art.currentTime = 0; await emit("video:canplay"); expect(state.art.currentTime).toBe(0); expect(state.art.url).toBe("");
    (state.refs[1].current as () => void)(); expect(state.message).toHaveBeenLastCalledWith(null); state.art.url = "";
    fetch.mockClear();
  }
});

it("reconnects once to the last position and play state, and offers reconnecting again if that fails", async () => {
  await mount(); state.message.mockClear();
  await emit("video:play"); await emit("video:timeupdate");
  fetch.mockResolvedValueOnce(new Response(null, { status: 503 })); await emit("video:error");
  // The failure pauses the element and resets its time; neither changes what the member was doing.
  await emit("video:pause"); state.art.currentTime = 0; await emit("video:timeupdate");
  (state.refs[1].current as () => void)();
  expect(state.art.url).toBe("http://localhost:6120/media/source"); expect(state.message).toHaveBeenLastCalledWith(null);
  await emit("video:pause"); await emit("video:canplay");
  expect(state.art.currentTime).toBe(1234); expect(state.art.play).toHaveBeenCalledOnce();
  // The restored range fails again: classified again, no automatic second restore.
  fetch.mockClear(); fetch.mockResolvedValueOnce(new Response(null, { status: 404 })); await emit("video:error");
  expect(fetch).toHaveBeenCalledOnce(); expect(state.message).toHaveBeenLastCalledWith({ text: expect.stringContaining("片源暂时无法播放"), reconnect: true });
  state.art.currentTime = 0; state.art.play.mockClear(); await emit("video:canplay");
  expect(state.art.currentTime).toBe(0); expect(state.art.play).not.toHaveBeenCalled();
});

it("never lets subtitle or late autoplay notices replace a video failure's reconnect", async () => {
  await mount(); state.message.mockClear();
  fetch.mockResolvedValueOnce(new Response(null, { status: 401 })); await emit("video:error");
  fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
  choose("off"); choose("en"); await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setTimeout(resolve, 0));
  expect(state.message).toHaveBeenCalledTimes(1);
  expect(state.message).toHaveBeenLastCalledWith({ text: expect.stringContaining("登录已失效"), reconnect: false, login: true });
  // A resume attempt that rejects only after the restored range has failed again stays silent.
  await emit("video:play");
  let reject: (error: Error) => void = () => {};
  state.art.play.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  (state.refs[1].current as () => void)(); await emit("video:canplay");
  fetch.mockResolvedValueOnce(new Response(null, { status: 404 })); await emit("video:error");
  reject(new Error("Fictional autoplay restriction")); await new Promise(resolve => setTimeout(resolve, 0));
  expect(state.message).toHaveBeenLastCalledWith({ text: expect.stringContaining("片源暂时无法播放"), reconnect: true });
});

it("clears a subtitle notice after choosing the track again succeeds and keeps a deliberate seek to zero", async () => {
  // ArtPlayer itself failing to load the checked VTT also turns subtitles off so the same track can be chosen again.
  state.art.subtitle.switch.mockRejectedValueOnce(new Error("Fictional subtitle parse failure"));
  await mount();
  expect(state.art.subtitle.show).toBe(false);
  expect(state.message).toHaveBeenLastCalledWith({ text: expect.stringContaining("请再次选择该字幕"), reconnect: false });
  choose("en"); await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setTimeout(resolve, 0));
  expect(state.art.subtitle.switch).toHaveBeenCalledTimes(2); expect(state.art.subtitle.show).toBe(true);
  expect(state.message).toHaveBeenLastCalledWith(null);
  await emit("video:timeupdate"); state.art.currentTime = 0; await emit("video:timeupdate");
  fetch.mockResolvedValueOnce(new Response(null, { status: 503 })); await emit("video:error");
  (state.refs[1].current as () => void)(); state.art.currentTime = 50; await emit("video:canplay");
  expect(state.art.currentTime).toBe(0);
});

it("leaves fullscreen for a failure that needs a button and echoes other notices inside the player", async () => {
  const art = Object.assign(state.art, { fullscreen: false, fullscreenWeb: true, notice: { show: "" } });
  state.art.subtitle.switch.mockRejectedValueOnce(new Error("Fictional subtitle parse failure"));
  await mount();
  expect(art.notice.show).toContain("请再次选择该字幕"); expect(art.fullscreenWeb).toBe(true);
  fetch.mockResolvedValueOnce(new Response(null, { status: 503 })); await emit("video:error");
  expect(art.fullscreenWeb).toBe(false);
});

it("keeps a failure's recovery toast until code closes it and lets other notices time out", () => {
  const actions = { reconnect: vi.fn(), login: vi.fn() };
  const sticky = { type: "error", timeout: 0, data: { dismissible: false } };
  const reconnect = noticeToast({ text: "片源暂时无法播放", reconnect: true }, actions);
  expect(reconnect).toMatchObject({ title: "片源暂时无法播放", ...sticky, actionProps: { children: "重新连接" } });
  // High priority would hide the toast, and so its button, from assistive tech until F6.
  expect(reconnect.priority).toBeUndefined();
  (reconnect.actionProps as { onClick: () => void }).onClick(); expect(actions.reconnect).toHaveBeenCalledOnce();
  const login = noticeToast({ text: "登录已失效", reconnect: false, login: true }, actions);
  expect(login).toMatchObject({ ...sticky, actionProps: { children: "重新登录" } });
  (login.actionProps as { onClick: () => void }).onClick(); expect(actions.login).toHaveBeenCalledOnce();
  expect(noticeToast({ text: "字幕加载失败", reconnect: false }, actions)).toEqual({ title: "字幕加载失败", type: "info" });
});

it("returns to the saved start when the first load fails before the player is ready", async () => {
  await mount({ startSeconds: 600 });
  state.art.currentTime = 0; await emit("video:timeupdate");
  fetch.mockResolvedValueOnce(new Response(null, { status: 503 })); await emit("video:error");
  (state.refs[1].current as () => void)(); await emit("video:canplay");
  expect(state.art.currentTime).toBe(600);
});

it("reconnects to the actual start when a saved position is beyond the media", async () => {
  await mount({ startSeconds: 5000 });
  state.art.currentTime = 0; await emit("ready");
  fetch.mockResolvedValueOnce(new Response(null, { status: 503 })); await emit("video:error");
  (state.refs[1].current as () => void)(); state.art.currentTime = 30; await emit("video:canplay");
  expect(state.art.currentTime).toBe(0);
});

it("keeps a member's pause across a reconnect and reports a blocked automatic resume", async () => {
  await mount(); state.message.mockClear();
  await emit("video:play"); await emit("video:timeupdate"); await emit("video:pause");
  fetch.mockResolvedValueOnce(new Response(null, { status: 401 })); await emit("video:error");
  (state.refs[1].current as () => void)(); await emit("video:canplay");
  expect(state.art.currentTime).toBe(1234); expect(state.art.play).not.toHaveBeenCalled();
  await emit("video:play"); await emit("video:timeupdate");
  fetch.mockResolvedValueOnce(new Response(null, { status: 503 })); await emit("video:error");
  (state.refs[1].current as () => void)(); state.art.play.mockRejectedValueOnce(new Error("Fictional autoplay restriction"));
  await emit("video:canplay"); await new Promise(resolve => setTimeout(resolve, 0));
  expect(state.message).toHaveBeenLastCalledWith({ text: expect.stringContaining("请点击播放"), reconnect: false });
});

const tiers: PlaybackSource = { ...source, qualities: [{ label: "2160p", url: "/media/source", type: vp9uhd }, { label: "1080p", url: "/media/p1080", type: vp9hd }, { label: "720p", url: "/media/p720", type: h264 }] };
type Control = { name: string; html: string; selector: { html: string; default: boolean }[]; onSelect: (item: { html: string }) => Promise<string> };
const control = () => (state.options as { controls: Control[] }).controls[0];
function remember(label: string | null) {
  const storage = { getItem: vi.fn(() => label), setItem: vi.fn() };
  vi.stubGlobal("localStorage", storage); return storage;
}

it("shows no quality control when a unit has a single tier", async () => {
  await mount();
  expect((state.options as { controls: unknown[] }).controls).toEqual([]);
});

it("starts on the remembered quality when the unit has it and on the highest tier otherwise", async () => {
  remember("720p"); await mount({ source: tiers });
  expect(state.options).toMatchObject({ url: "http://localhost:6120/media/p720" });
  expect(control()).toMatchObject({ name: "quality", html: "720p", selector: [{ html: "2160p", default: false }, { html: "1080p", default: false }, { html: "720p", default: true }] });
  cleanups.forEach(cleanup => cleanup?.()); state.effects.length = 0; state.refs.length = 0; state.refIndex = 0;
  remember("480p"); await mount({ source: tiers });
  expect(state.options).toMatchObject({ url: "http://localhost:6120/media/source" }); expect(control().html).toBe("2160p");
});

it("starts on the highest tier this browser can decode yet still lists every tier", async () => {
  const remount = async () => { cleanups.forEach(cleanup => cleanup?.()); state.effects.length = 0; state.refs.length = 0; state.refIndex = 0; await mount({ source: tiers }); };
  // A device that decodes 1080p VP9 but not 2160p starts on 1080p.
  remember(null); page.undecodable.add(vp9uhd); await mount({ source: tiers });
  expect(state.options).toMatchObject({ url: "http://localhost:6120/media/p1080" });
  expect(control()).toMatchObject({ html: "1080p", selector: [{ html: "2160p", default: false }, { html: "1080p", default: true }, { html: "720p", default: false }] });
  page.undecodable.add(vp9hd); await remount();
  expect(state.options).toMatchObject({ url: "http://localhost:6120/media/p720" }); expect(control().html).toBe("720p");
  // When nothing reports decodable the highest tier is still the start; a failure is left to the member.
  page.undecodable.add(h264); await remount();
  expect(state.options).toMatchObject({ url: "http://localhost:6120/media/source" });
});

it("switches quality in place, remembers it, keeps the position through the switch and recovers on the chosen quality", async () => {
  const storage = remember(null); await mount({ source: tiers }); state.message.mockClear();
  await emit("video:play"); await emit("video:timeupdate");
  // While switching, the element pauses and briefly reports 0; neither is the member's position or choice.
  state.art.switchQuality.mockImplementationOnce(async () => { state.art.currentTime = 0; await emit("video:pause"); await emit("video:timeupdate"); state.art.currentTime = 1234; });
  expect(await control().onSelect({ html: "720p" })).toBe("720p");
  expect(state.art.switchQuality).toHaveBeenCalledExactlyOnceWith("http://localhost:6120/media/p720");
  expect(storage.setItem).toHaveBeenCalledExactlyOnceWith("player-quality", "720p");
  expect(reports()).toEqual([]);
  // A failure checks and reconnects the current quality, back at the last position and play state.
  fetch.mockResolvedValueOnce(new Response(null, { status: 503 })); await emit("video:error");
  expect(fetch).toHaveBeenLastCalledWith("http://localhost:6120/media/p720", { method: "HEAD", credentials: "same-origin", cache: "no-store" });
  state.art.currentTime = 0; (state.refs[1].current as () => void)();
  expect(state.art.url).toBe("http://localhost:6120/media/p720");
  await emit("video:canplay");
  expect(state.art.currentTime).toBe(1234); expect(state.art.play).toHaveBeenCalledOnce();
});

it("serializes rapid quality choices so a second switch cannot snapshot the first reload's zero position", async () => {
  const storage = remember(null); await mount({ source: tiers });
  const player = Object.assign(state.art, { playbackRate: 2 });
  let finish: () => void = () => {};
  state.art.switchQuality.mockImplementation(async () => {
    const position = player.currentTime, rate = player.playbackRate;
    player.currentTime = 0; player.playbackRate = 1;
    await new Promise<void>(resolve => { finish = resolve; });
    player.currentTime = position; player.playbackRate = rate;
  });
  const first = control().onSelect({ html: "720p" });
  await settle();
  expect(state.art.switchQuality).toHaveBeenCalledTimes(1);
  const second = control().onSelect({ html: "1080p" });
  await settle();
  expect(state.art.switchQuality).toHaveBeenCalledTimes(1);
  finish(); await first; await settle();
  expect(state.art.switchQuality).toHaveBeenNthCalledWith(2, "http://localhost:6120/media/p1080");
  finish();
  expect(await second).toBe("1080p");
  expect(player.currentTime).toBe(1234); expect(player.playbackRate).toBe(2);
  expect(storage.setItem).toHaveBeenLastCalledWith("player-quality", "1080p");
});

it("reconnects on a newly chosen quality when the current one has failed", async () => {
  remember(null); await mount({ source: tiers }); state.message.mockClear();
  await emit("video:timeupdate");
  fetch.mockResolvedValueOnce(new Response(null, { status: 404 })); await emit("video:error");
  expect(state.message).toHaveBeenLastCalledWith({ text: expect.stringContaining("片源暂时无法播放"), reconnect: true });
  state.art.currentTime = 0;
  expect(await control().onSelect({ html: "1080p" })).toBe("1080p");
  expect(state.art.switchQuality).not.toHaveBeenCalled();
  expect(state.art.url).toBe("http://localhost:6120/media/p1080"); expect(state.message).toHaveBeenLastCalledWith(null);
  await emit("video:canplay"); expect(state.art.currentTime).toBe(1234);
});

it.each(["AbortError", "NotAllowedError"])("keeps reporting after a quality resume rejects with %s", async name => {
  remember(null); await mount({ source: tiers }); state.message.mockClear();
  state.art.switchQuality.mockRejectedValueOnce(new DOMException("Fictional interrupted resume", name));
  expect(await control().onSelect({ html: "720p" })).toBe("720p");
  if (name === "NotAllowedError") expect(state.message).toHaveBeenLastCalledWith({ text: "浏览器阻止自动播放，请点击播放。", reconnect: false });
  else expect(state.message).not.toHaveBeenCalled();
  respond({ data: { positionSeconds: 1260, completed: false, updatedAt: 1, revision: 1 } });
  await emit("video:play"); state.art.currentTime = 1260; await emit("video:timeupdate"); await emit("video:pause"); await settle();
  expect(reports()).toEqual([{ url: "/me/progress/episode-unit", keepalive: false, positionSeconds: 1260, expectedRevision: 0 }]);
});

it("keeps a quality failure's recovery notice when its resume also rejects", async () => {
  remember(null); await mount({ source: tiers }); state.message.mockClear();
  state.art.switchQuality.mockImplementationOnce(async () => {
    fetch.mockResolvedValueOnce(new Response(null, { status: 404 })); await emit("video:error");
    throw new DOMException("Fictional blocked resume after failure", "NotAllowedError");
  });
  expect(await control().onSelect({ html: "720p" })).toBe("720p");
  expect(state.message).toHaveBeenCalledExactlyOnceWith({ text: expect.stringContaining("片源暂时无法播放"), reconnect: true });
});

it("leaves subtitle choice to the player's own menu, which starts on the first listed track", async () => {
  const unit: Episode = { id: "episode-unit", number: 1, seasonNumber: 1, tmdbId: 1, titleZh: "测试片", titleEn: "Test",
    overviewZh: null, overviewEn: null, airDate: null, runtimeMin: null, durationSeconds: 4, still: null, playable: true,
    positionSeconds: 0, completed: false, updatedAt: 0, revision: 0 };
  const work: Work = { slug: "test", href: "/movies/test", kind: "movie", tmdbId: 1, titleZh: "测试片", titleEn: "Test", overviewZh: null,
    overviewEn: null, year: 2026, poster: "", code: "", seasonCount: 0, episodeCount: 1, watchedCount: 0,
    favorite: false, seasons: [], units: [unit] };
  const loaderData = { work, unit, source, previous: "", next: "", reportInterval: 15 as const, danmaku, admin: false };
  const root = { member: null, catalog: null, commit: "0123456789abcdef0123456789abcdef01234567", ray: null, colo: null };
  const page = Watch({ loaderData, params: { slug: "test" }, matches: [
    { id: "root", params: {}, pathname: "/", data: root, loaderData: root, handle: undefined },
    { id: "movie-watch", params: { slug: "test" }, pathname: "/movies/test/watch", data: loaderData, loaderData, handle: undefined },
  ] });
  state.pageIndex = 0;
  const tree = (page.type as (props: typeof page.props) => ReactNode)(page.props);
  state.pageIndex = null;
  // ArtPlayer keeps its hotkeys after a click even when Tab moves focus on, so a page control would lose its keys.
  expect(elements(tree, "select")).toEqual([]);
  expect((elements(tree, Player)[0].props as Parameters<typeof Player>[0]).source).toBe(source);
  state.effects.length = 0; state.refs.length = 0; state.refIndex = 0;
  await mount({ source: { ...source, tracks: [{ id: "zh", language: "zh-CN", displayName: "简中", url: "/subtitles/zh" }, { id: "zh-en", language: "zh-CN", displayName: "简英", url: "/subtitles/zh-en" }] } });
  expect(fetch).toHaveBeenCalledExactlyOnceWith("http://localhost:6120/subtitles/zh", { credentials: "same-origin", cache: "no-store" });
  expect(state.art.setting.update).toHaveBeenLastCalledWith({ name: "subtitle-lang", html: "字幕", selector: [
    { html: "简中", id: "zh", default: true }, { html: "简英", id: "zh-en", default: false }, { html: "关闭", id: "off", default: false }] });
});

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const reports = () => fetch.mock.calls.filter(([, init]) => init?.method === "PUT").map(([url, init]) => ({ url, keepalive: init?.keepalive, ...JSON.parse(String(init?.body)) }));
function respond(...replies: (object | Promise<Response>)[]) {
  fetch.mockImplementation(async (_, init) => {
    if (init?.method !== "PUT") return new Response("WEBVTT\n\n");
    const reply = replies.shift()!;
    return reply instanceof Promise ? reply : Response.json(reply, { status: "error" in reply ? 409 : 200 });
  });
}

it("reports one position at a time with the shared revision and drops a refused report instead of replaying it", async () => {
  const revision = { current: 3 }, onSaved = vi.fn(), timer = vi.spyOn(globalThis, "setInterval");
  let release: (response: Response) => void = () => {};
  respond({ data: { positionSeconds: 1234, completed: false, updatedAt: 1, revision: 4 } }, { error: { code: "REVISION_CONFLICT", revision: 9 } },
    new Promise<Response>(resolve => { release = resolve; }));
  await mount({ progress: { revision, interval: 15, duration: 3000, onSaved } });
  const [tick, delay] = timer.mock.calls.at(-1)! as [() => void, number];
  expect(delay).toBe(15000);
  tick(); await settle();
  expect(reports()).toEqual([{ url: "/me/progress/episode-unit", keepalive: false, positionSeconds: 1234, expectedRevision: 3 }]);
  expect(revision.current).toBe(4); expect(onSaved).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ revision: 4 }));
  tick(); await settle();
  expect(reports()).toHaveLength(1);
  state.art.currentTime = 1300; await emit("video:timeupdate"); tick(); await settle();
  expect(reports()[1]).toMatchObject({ positionSeconds: 1300, expectedRevision: 4 });
  expect(revision.current).toBe(9); expect(onSaved).toHaveBeenCalledOnce();
  tick(); await settle();
  expect(reports()).toHaveLength(2);
  state.art.currentTime = 1400; await emit("video:timeupdate"); tick(); tick(); await settle();
  expect(reports()).toHaveLength(3); expect(reports()[2]).toMatchObject({ positionSeconds: 1400, expectedRevision: 9 });
  release(Response.json({ data: { positionSeconds: 1400, completed: false, updatedAt: 2, revision: 10 } })); await settle();
  expect(revision.current).toBe(10);
});

it("reports on pause, at the end, when the page is hidden and when leaving the unit, within the known duration", async () => {
  const reply = (revision: number) => ({ data: { positionSeconds: 0, completed: false, updatedAt: 1, revision } });
  respond(reply(1), reply(2), reply(3));
  await mount({ progress: { revision: { current: 0 }, interval: 15, duration: 1000, onSaved: vi.fn() } });
  await emit("video:pause"); await settle();
  expect(reports()).toEqual([expect.objectContaining({ positionSeconds: 1000, expectedRevision: 0, keepalive: false })]);
  await emit("video:ended"); await settle();
  expect(reports()).toHaveLength(1);
  state.art.currentTime = 400; await emit("video:timeupdate");
  page.visibilityState = "hidden"; page.listeners.get("visibilitychange")!(); await settle();
  expect(reports()[1]).toMatchObject({ positionSeconds: 400, expectedRevision: 1, keepalive: true });
  state.art.currentTime = 500; await emit("video:timeupdate");
  cleanups.forEach(cleanup => cleanup?.()); cleanups = []; await settle();
  expect(reports()[2]).toMatchObject({ positionSeconds: 500, expectedRevision: 2, keepalive: true });
});

it("does not report before the saved start is applied", async () => {
  const timer = vi.spyOn(globalThis, "setInterval");
  await mount({ startSeconds: 600, progress: { revision: { current: 0 }, interval: 15, duration: 3000, onSaved: vi.fn() } });
  (timer.mock.calls.at(-1)![0] as () => void)(); await emit("video:pause"); await settle();
  expect(reports()).toEqual([]);
});

it("tries to autoplay once the saved start is applied and leaves the play button when the browser blocks it", async () => {
  await mount(); expect(state.art.play).not.toHaveBeenCalled();
  cleanups.forEach(cleanup => cleanup?.()); state.effects.length = 0; state.refs.length = 0; state.refIndex = 0; state.handlers.clear(); vi.clearAllMocks();
  let startAtPlay = 0;
  state.art.play.mockImplementationOnce(async () => { startAtPlay = state.art.seek; throw new Error("Fictional autoplay restriction"); });
  await mount({ startSeconds: 600, autoplay: true }); expect(state.art.play).not.toHaveBeenCalled();
  await emit("ready"); await settle();
  expect(state.art.play).toHaveBeenCalledOnce(); expect(startAtPlay).toBe(600);
  expect(state.message).toHaveBeenLastCalledWith({ text: expect.stringContaining("请点击播放"), reconnect: false });
});

it("says where playback resumes from the saved start", async () => {
  await mount({ startSeconds: 600 }); await emit("ready");
  expect(state.art.seek).toBe(600); expect(state.art.notice.show).toBe("从上次的位置继续（15%）");
});

it("hands the end to the page after the final report and leaves fullscreen only for a next-up prompt", async () => {
  const art = Object.assign(state.art, { fullscreen: true, fullscreenWeb: false, notice: { show: "" } }), onEnded = vi.fn();
  respond({ data: { positionSeconds: 1000, completed: true, updatedAt: 1, revision: 1 } });
  await mount({ onEnded, progress: { revision: { current: 0 }, interval: 15, duration: 1000, onSaved: vi.fn() } });
  await emit("video:ended"); await settle();
  expect(reports()).toEqual([expect.objectContaining({ positionSeconds: 1000, expectedRevision: 0 })]);
  expect(onEnded).toHaveBeenCalledOnce(); expect(art.fullscreen).toBe(false);
  cleanups.forEach(cleanup => cleanup?.()); state.effects.length = 0; state.refs.length = 0; state.refIndex = 0; state.handlers.clear();
  art.fullscreenWeb = true; await mount(); await emit("video:ended");
  expect(art.fullscreenWeb).toBe(true);
  art.fullscreenWeb = false;
});

it("offers the next unit when playback ends and autoplays only after a fresh step from the prompt", () => {
  const episode = (id: string, number: number): Episode => ({ id, number, seasonNumber: 1, tmdbId: number, titleZh: `虚构第 ${number} 集`, titleEn: null,
    overviewZh: null, overviewEn: null, airDate: null, runtimeMin: null, durationSeconds: 4, still: null, playable: true, positionSeconds: 0, completed: false, updatedAt: 0, revision: 0 });
  const first = episode("episode-unit", 1), second = episode("episode-two", 2);
  const work: Work = { slug: "series", href: "/series/svy", kind: "series", tmdbId: 1, titleZh: "虚构勘测队", titleEn: "Fictional Survey", overviewZh: null, overviewEn: null, year: 2026,
    poster: "", code: "", seasonCount: 1, episodeCount: 2, watchedCount: 0, favorite: false, seasons: [{ id: "season", number: 1, episodes: [first, second] }], units: [first, second] };
  const view = (unit: Episode, previous?: string, next?: string) => {
    const loaderData = { work, unit, source, previous, next, reportInterval: 15 as const, danmaku, admin: false };
    const page = Watch({ loaderData, params: { code: "svy", season: "s1", episode: `e${unit.number}` }, matches: [] as never });
    state.pageIndex = 0;
    const tree = (page.type as (props: typeof page.props) => ReactNode)(page.props);
    state.pageIndex = null;
    return elements(tree, Player)[0].props as Parameters<typeof Player>[0];
  };
  let player = view(first, undefined, second.id);
  expect(player.autoplay).toBe(false); expect(player.children).toBeFalsy();
  player.onEnded!();
  player = view(first, undefined, second.id);
  const prompt = player.children as ReactElement<{ to: string; onCancel: () => void }>;
  expect(prompt.props.to).toBe("/series/svy/s1/e2");
  prompt.props.onCancel(); expect(view(first, undefined, second.id).children).toBeFalsy();
  // The last unit has nothing to offer, so the end stays with the player.
  state.pageState.length = 0; expect(view(second, first.id).onEnded).toBeUndefined();
  // Reloading or going back to a page reached from the prompt does not autoplay again.
  state.location = { state: { autoplay: true } };
  state.pageState.length = 0; expect(view(second, first.id).autoplay).toBe(false);
  state.navigation = "PUSH"; state.pageState.length = 0; expect(view(second, first.id).autoplay).toBe(true);
  state.location = { state: null }; state.pageState.length = 0; expect(view(second, first.id).autoplay).toBe(false);
});

it("lets a playlist queue decide what follows and end on the way back to the playlist", () => {
  const unit: Episode = { id: "episode-unit", number: 1, seasonNumber: 1, tmdbId: 1, titleZh: "虚构第 1 集", titleEn: null, overviewZh: null, overviewEn: null, airDate: null,
    runtimeMin: null, durationSeconds: 4, still: null, playable: true, positionSeconds: 0, completed: false, updatedAt: 0, revision: 0 };
  const work: Work = { slug: "series", href: "/series/svy", kind: "series", tmdbId: 1, titleZh: "虚构勘测队", titleEn: "Fictional Survey", overviewZh: null, overviewEn: null, year: 2026,
    poster: "", code: "", seasonCount: 1, episodeCount: 1, watchedCount: 0, favorite: false, seasons: [{ id: "season", number: 1, episodes: [unit] }], units: [unit] };
  const movie = { id: "movie-unit", href: "/movies/test/watch", completed: false, poster: "", label: "电影", year: null, title: "测试信号" };
  const view = (queue: { id: string; title: string; next: typeof movie | null }) => {
    const loaderData = { work, unit, source, previous: undefined, next: undefined, reportInterval: 15 as const, danmaku, admin: false, queue: { ...queue, position: 0, watched: [false, false] } };
    const page = Watch({ loaderData, params: { code: "svy", season: "s1", episode: "e1" }, matches: [] as never });
    state.pageIndex = 0;
    const tree = (page.type as (props: typeof page.props) => ReactNode)(page.props);
    state.pageIndex = null;
    return elements(tree, Player)[0].props as Parameters<typeof Player>[0];
  };
  // The queue's next unit is offered even where the series has no natural next, and the step keeps the queue.
  let player = view({ id: "list", title: "虚构片单", next: movie });
  player.onEnded!();
  const prompt = view({ id: "list", title: "虚构片单", next: movie }).children as ReactElement<{ to: string; label: string }>;
  expect(prompt.props).toMatchObject({ to: "/movies/test/watch?playlist=list", label: "片单 · 电影" });
  // At the queue's end the page offers the way back instead of a natural next unit or a loop.
  state.pageState.length = 0; player = view({ id: "list", title: "虚构片单", next: null });
  player.onEnded!();
  const end = view({ id: "list", title: "虚构片单", next: null }).children as ReactElement<{ playlist: { id: string } }>;
  expect(end.props.playlist).toMatchObject({ id: "list" });
});

const plugin = () => state.art.plugins.artplayerPluginDanmuku;
const danmakuOption = () => state.danmaku as DanmakuOption & Required<Pick<DanmakuOption, "beforeEmit" | "beforeVisible">> & { danmuku: () => Promise<unknown[]> };

it("reads danmaku once and keeps playing without them when the read fails", async () => {
  const items = [{ id: "d1", time: 1.5, text: "虚构", mode: 0, color: "#FFFFFF" }];
  await mount();
  expect(danmakuOption()).toMatchObject({ COLOR: [...danmaku.colors], maxLength: danmaku.maxLength, lockTime: danmaku.lockTime });
  fetch.mockResolvedValueOnce(Response.json({ data: { items } }));
  expect(await danmakuOption().danmuku()).toEqual(items);
  expect(fetch).toHaveBeenLastCalledWith("/units/episode-unit/danmaku", expect.objectContaining({ method: "GET", credentials: "same-origin" }));
  expect(state.message).not.toHaveBeenCalled();
  fetch.mockResolvedValueOnce(Response.json({ error: { code: "INTERNAL_ERROR" } }, { status: 500 }));
  expect(await danmakuOption().danmuku()).toEqual([]);
  expect(state.message).toHaveBeenLastCalledWith({ text: "弹幕加载失败，刷新页面可重试。", reconnect: false });
});

it("shows a sent danmaku only after the server accepts it and says why one was refused", async () => {
  await mount(); state.art.currentTime = 12.34;
  fetch.mockResolvedValueOnce(Response.json({ error: { code: "DANMAKU_RATE_LIMITED", message: "发送太快，请 5 秒后再试。" } }, { status: 429 }));
  const draft = { text: " 虚构 ", mode: 1 as const, color: "#F2C14E" };
  expect(await danmakuOption().beforeEmit(draft)).toBe(false);
  expect(fetch).toHaveBeenLastCalledWith("/units/episode-unit/danmaku", expect.objectContaining({ method: "POST",
    body: JSON.stringify({ text: " 虚构 ", time: 12.34, mode: 1, color: "#F2C14E" }) }));
  expect(state.message).toHaveBeenLastCalledWith({ text: "发送太快，请 5 秒后再试。", reconnect: false });
  fetch.mockRejectedValueOnce(new TypeError("offline"));
  expect(await danmakuOption().beforeEmit({ ...draft })).toBe(false);
  expect(state.message).toHaveBeenLastCalledWith({ text: "弹幕未发送，请稍后重试。", reconnect: false });
  fetch.mockResolvedValueOnce(Response.json({ data: { item: { id: "d1", time: 12.3, text: "虚构", mode: 1, color: "#F2C14E" } } }));
  expect(await danmakuOption().beforeEmit(draft)).toBe(true);
  expect(draft).toMatchObject({ id: "d1", text: "虚构" });
});

it("hides blocked words and deleted danmaku, clearing the screen when either changes", async () => {
  await mount();
  const visible = (item: { id?: string; text: string }) => danmakuOption().beforeVisible(item);
  expect(visible({ id: "a", text: "Engage!" })).toBe(true);
  setBlockedWords(["engage"]);
  expect(plugin().reset).toHaveBeenCalledOnce();
  expect(visible({ id: "a", text: "ENGAGE!" })).toBe(false); expect(visible({ id: "b", text: "曲速" })).toBe(true);
  forgetDanmaku("b");
  expect(plugin().reset).toHaveBeenCalledTimes(2); expect(visible({ id: "b", text: "曲速" })).toBe(false);
  // A destroyed player hears nothing more.
  cleanups.forEach(cleanup => cleanup?.()); cleanups = [];
  setBlockedWords([]);
  expect(plugin().reset).toHaveBeenCalledTimes(2);
});

it("restores valid danmaku settings saved in this browser and saves them on every change", async () => {
  const store = new Map([["player-danmaku", JSON.stringify({ opacity: 0.5, speed: 99, mode: 2, color: "#123456", fontSize: "4%", margin: [10, "bad"], visible: false, modes: [0, 3] })]]);
  vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
  await mount();
  expect(danmakuOption()).toMatchObject({ opacity: 0.5, speed: 7, mode: 2, fontSize: "4%", margin: [10, "25%"], visible: false });
  expect(danmakuOption()).not.toHaveProperty("color"); expect(danmakuOption()).not.toHaveProperty("modes");
  const option = { visible: true, opacity: 0.8, speed: 5, fontSize: 25, margin: [10, "50%"], modes: [0, 1], antiOverlap: false, synchronousPlayback: true, mode: 1, color: "#5BA4E6", maxLength: 50 };
  Object.assign(plugin(), { option, isHide: true });
  for (const event of ["artplayerPluginDanmuku:config", "artplayerPluginDanmuku:show", "artplayerPluginDanmuku:hide"]) {
    store.delete("player-danmaku"); await emit(event);
    expect(JSON.parse(store.get("player-danmaku")!), event).toEqual({ ...option, visible: false, maxLength: undefined });
  }
});

it("hands Space and the arrows back to page controls reached with Tab after a click on the video", async () => {
  await mount();
  const control = { name: "player control" }, button = { name: "page button" };
  state.art.template.$player.contains.mockImplementation(node => node === control);
  const focusin = page.listeners.get("focusin") as unknown as (event: { target: unknown }) => void;
  state.art.isFocus = true;
  focusin({ target: control }); expect(state.art.isFocus).toBe(true);
  focusin({ target: button }); expect(state.art.isFocus).toBe(false);
});

it("moves the danmaku emitter below the video when the control bar is too narrow, but not in fullscreen", async () => {
  await mount();
  const slot = { name: "slot" };
  state.refs[3].current = slot;
  await emit("resize"); await emit("resize");
  expect(plugin().mount).toHaveBeenCalledExactlyOnceWith(state.art.template.$controlsCenter);
  state.art.width = 819; await emit("resize");
  expect(plugin().mount).toHaveBeenLastCalledWith(slot);
  // The plugin itself moves the emitter into the bar in fullscreen and back afterwards.
  state.art.fullscreen = true; state.art.width = 1920; await emit("resize");
  expect(plugin().mount).toHaveBeenCalledTimes(2);
});

it("refuses danmaku before resume, during a quality switch and while reconnecting without posting zero", async () => {
  remember(null);
  await mount({ source: tiers, startSeconds: 600 });
  const draft = { text: "test", mode: 0 as const, color: "#FFFFFF" };
  state.art.currentTime = 0; fetch.mockClear();
  expect(await danmakuOption().beforeEmit({ ...draft })).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  await emit("ready");
  let loaded = () => {};
  state.art.switchQuality.mockImplementationOnce(() => new Promise<void>(resolve => { loaded = resolve; state.art.currentTime = 0; }));
  const switching = control().onSelect({ html: "720p" });
  await settle();
  expect(await danmakuOption().beforeEmit({ ...draft })).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  state.art.currentTime = 600; loaded(); await switching;
  await emit("video:timeupdate");
  fetch.mockResolvedValueOnce(new Response(null, { status: 503 })); await emit("video:error");
  (state.refs[1].current as () => void)(); state.art.currentTime = 0; fetch.mockClear();
  expect(await danmakuOption().beforeEmit({ ...draft })).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  await emit("video:canplay");
  fetch.mockResolvedValueOnce(Response.json({ data: { item: { id: "stable", text: "test" } } }));
  expect(await danmakuOption().beforeEmit({ ...draft })).toBe(true);
  expect(JSON.parse(String(fetch.mock.calls.at(-1)![1]?.body)).time).toBe(600);
});

it("places the narrow emitter before the first media event", async () => {
  Player({ unitId: "episode-unit", source, startSeconds: 600, progress: { revision: { current: 0 }, interval: 15, duration: null, onSaved: vi.fn() },
    danmaku });
  state.refs[0].current = {};
  const slot = { name: "slot" };
  state.refs[3].current = slot; state.art.width = 700;
  cleanups = state.effects.map(effect => effect());
  await vi.dynamicImportSettled(); await settle();
  expect(plugin().mount).toHaveBeenCalledExactlyOnceWith(slot);
});

it("has a named speed step for the default and writes unchanged settings only once", async () => {
  const store = new Map<string, string>(), setItem = vi.fn((key: string, value: string) => { store.set(key, value); });
  vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null, setItem });
  await mount();
  const option = danmakuOption();
  expect(option.SPEED?.steps?.some(step => step.value === option.speed)).toBe(true);
  Object.assign(plugin(), { option, isHide: false });
  await emit("artplayerPluginDanmuku:show"); await emit("artplayerPluginDanmuku:config");
  expect(setItem).toHaveBeenCalledTimes(1);
});

it("reserves the measured external emitter height and observes it as fullscreen moves it", () => {
  const setProperty = vi.fn(), parentElement = {}, slot = { getBoundingClientRect: () => ({ height: 40 }) }, observed: unknown[] = [];
  let measure = () => {};
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { measure = callback; } observe(value: unknown) { observed.push(value); } disconnect() {} });
  vi.stubGlobal("window", { scrollY: 0, addEventListener() {}, removeEventListener() {} });
  Player({ unitId: "episode-unit", source, startSeconds: 0, progress: { revision: { current: 0 }, interval: 15, duration: null, onSaved: vi.fn() },
    danmaku });
  state.refs[2].current = { style: { setProperty }, parentElement, getBoundingClientRect: () => ({ top: 112 }) };
  state.refs[3].current = slot;
  const cleanup = state.effects[1]();
  expect(observed).toEqual([parentElement, slot]);
  expect(setProperty).toHaveBeenCalledWith("--player-emitter", "40px");
  slot.getBoundingClientRect = () => ({ height: 0 }); measure();
  expect(setProperty).toHaveBeenLastCalledWith("--player-emitter", "0px");
  cleanup?.();
});
