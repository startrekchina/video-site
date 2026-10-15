import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Player, noticeToast } from "@/components/site/player";
import Watch from "@/routes/watch";
import { TabsTrigger } from "@/components/ui/tabs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { PlaybackSource } from "@/lib/playback.server";
import type { Episode, Work } from "@/lib/catalog";

type Handler = (...args: unknown[]) => unknown;
const state = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[], refs: [] as { current: unknown }[], message: vi.fn(), options: null as unknown,
  pageState: [] as unknown[], pageIndex: null as number | null, refIndex: 0, handlers: new Map<string, Handler[]>(),
  art: { currentTime: 1234, duration: 4000, seek: 0, url: "", destroy: vi.fn(), hotkey: { add: vi.fn() },
    on: vi.fn(), once: vi.fn(), play: vi.fn(), subtitle: { switch: vi.fn(), show: false }, setting: { update: vi.fn() } },
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
vi.mock("react-router", async original => ({ ...await original<typeof import("react-router")>(), UNSAFE_withComponentProps: (component: unknown) => component }));
vi.mock("@/components/ui/button", () => ({ Button: () => null }));

const source: PlaybackSource = { url: "/media/source", tracks: [{ id: "en", language: "en", displayName: "English", url: "/subtitles/en" }] };
const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
let cleanups: (void | (() => void))[] = [], blobs = 0;
const emit = (event: string) => Promise.all((state.handlers.get(event) ?? []).map(handler => handler()));
beforeEach(() => {
  vi.clearAllMocks();
  state.effects.length = 0; state.refs.length = 0; state.refIndex = 0; state.pageState.length = 0; state.pageIndex = null;
  state.handlers.clear(); state.art.currentTime = 1234; state.art.url = ""; state.art.subtitle.show = false;
  const listen = (event: string, handler: Handler) => { state.handlers.set(event, [...state.handlers.get(event) ?? [], handler]); };
  state.art.on.mockImplementation(listen); state.art.once.mockImplementation(listen);
  state.art.subtitle.switch.mockReset().mockResolvedValue(undefined);
  state.art.play.mockReset().mockResolvedValue(undefined);
  fetch.mockReset().mockImplementation(async () => new Response("WEBVTT\n\n"));
  blobs = 0;
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("location", { origin: "http://localhost:6120" });
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => `blob:fictional-${++blobs}`), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanups.forEach(cleanup => cleanup?.()); cleanups = []; vi.unstubAllGlobals(); });

async function mount(props: Partial<Parameters<typeof Player>[0]> = {}) {
  const callbacks = { onSubtitleChange: vi.fn(), onTracksChange: vi.fn() };
  Player({ unitId: "episode-unit", source, startSeconds: 0, subtitle: "en", ...callbacks, ...props });
  state.refs[0].current = {};
  cleanups = state.effects.map(effect => effect());
  await vi.dynamicImportSettled(); await new Promise(resolve => setTimeout(resolve, 0));
  if (!props.startSeconds) await emit("ready");
  return callbacks;
}
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
  let callbacks = await mount();
  expect(callbacks.onTracksChange).toHaveBeenCalledExactlyOnceWith([]);
  expect(callbacks.onSubtitleChange).toHaveBeenCalledExactlyOnceWith("off");
  expect(state.art.subtitle.switch).not.toHaveBeenCalled(); expect(state.art.subtitle.show).toBe(false);
  expect(state.art.setting.update).toHaveBeenLastCalledWith({ name: "subtitle-lang", html: "字幕", selector: [{ html: "关闭", id: "off", default: true }] });
  expect(state.message).toHaveBeenLastCalledWith({ text: expect.stringContaining("已从字幕选项中移除"), reconnect: false });
  cleanups.forEach(cleanup => cleanup?.()); state.effects.length = 0; state.refs.length = 0; state.refIndex = 0; vi.clearAllMocks();
  fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
  callbacks = await mount();
  expect(callbacks.onTracksChange).not.toHaveBeenCalled();
  expect(callbacks.onSubtitleChange).toHaveBeenCalledExactlyOnceWith("off");
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
  const select = state.refs[3].current as (id: string) => void;
  fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
  select("off"); select("en"); await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setTimeout(resolve, 0));
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
  const callbacks = await mount();
  expect(callbacks.onSubtitleChange).toHaveBeenCalledExactlyOnceWith("off"); expect(state.art.subtitle.show).toBe(false);
  expect(state.message).toHaveBeenLastCalledWith({ text: expect.stringContaining("请再次选择该字幕"), reconnect: false });
  (state.refs[3].current as (id: string) => void)("en"); await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setTimeout(resolve, 0));
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
  const sticky = { type: "error", priority: "high", timeout: 0, data: { dismissible: false } };
  const reconnect = noticeToast({ text: "片源暂时无法播放", reconnect: true }, actions);
  expect(reconnect).toMatchObject({ title: "片源暂时无法播放", ...sticky, actionProps: { children: "重新连接" } });
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

it("keeps watch page subtitle choices in step with a removed track without restarting the player", async () => {
  const unit: Episode = { id: "episode-unit", number: 1, seasonNumber: 1, tmdbId: 1, titleZh: "测试片", titleEn: "Test",
    overviewZh: null, overviewEn: null, runtimeMin: null, durationSeconds: 4, still: null, playable: true,
    positionSeconds: 0, completed: false, updatedAt: 0, revision: 0 };
  const work: Work = { slug: "test", kind: "movie", tmdbId: 1, titleZh: "测试片", titleEn: "Test", overviewZh: null,
    overviewEn: null, year: 2026, poster: "", code: "", seasonCount: 0, episodeCount: 1, watchedCount: 0,
    favorite: false, seasons: [], units: [unit] };
  const loaderData = { work, unit, source, previous: "", next: "" };
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
  expect(view.player.source).toBe(source);
  fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
  state.effects.length = 0; state.refs.length = 0; state.refIndex = 0;
  Player(view.player); state.refs[0].current = {};
  cleanups = state.effects.map(effect => effect());
  await vi.dynamicImportSettled(); await new Promise(resolve => setTimeout(resolve, 0));
  view = render();
  expect(view.tabs.map(tab => tab.props.value)).toEqual(["off"]);
  expect(view.player.subtitle).toBe("off");
  expect(state.art.destroy).not.toHaveBeenCalled();
});
