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
  location: { state: null as unknown }, navigation: "POP",
  art: { currentTime: 1234, duration: 4000, seek: 0, url: "", destroy: vi.fn(), hotkey: { add: vi.fn() },
    on: vi.fn(), once: vi.fn(), play: vi.fn(), switchQuality: vi.fn(), subtitle: { switch: vi.fn(), show: false }, setting: { update: vi.fn() } },
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
vi.mock("react-router", async original => ({ ...await original<typeof import("react-router")>(), UNSAFE_withComponentProps: (component: unknown) => component,
  useLocation: () => state.location, useNavigationType: () => state.navigation }));
vi.mock("@/components/ui/button", () => ({ Button: () => null }));

const source: PlaybackSource = { url: "/media/source", qualities: [{ label: "原画", url: "/media/source" }], tracks: [{ id: "en", language: "en", displayName: "English", url: "/subtitles/en" }] };
const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
let cleanups: (void | (() => void))[] = [], blobs = 0;
const page = { visibilityState: "visible", listeners: new Map<string, () => void>() };
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
  fetch.mockReset().mockImplementation(async () => new Response("WEBVTT\n\n"));
  blobs = 0;
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("location", { origin: "http://localhost:6120" });
  page.visibilityState = "visible"; page.listeners.clear();
  const on = (type: string, handler: () => void) => { page.listeners.set(type, handler); };
  vi.stubGlobal("document", { get visibilityState() { return page.visibilityState; }, addEventListener: on, removeEventListener: vi.fn() });
  vi.stubGlobal("window", { addEventListener: on, removeEventListener: vi.fn() });
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => `blob:fictional-${++blobs}`), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanups.forEach(cleanup => cleanup?.()); cleanups = []; vi.unstubAllGlobals(); });

async function mount(props: Partial<Parameters<typeof Player>[0]> = {}) {
  const callbacks = { onSubtitleChange: vi.fn(), onTracksChange: vi.fn() };
  Player({ unitId: "episode-unit", source, startSeconds: 0, progress: { revision: { current: 0 }, interval: 15, duration: null, onSaved: vi.fn() }, subtitle: "en", ...callbacks, ...props });
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

const tiers: PlaybackSource = { ...source, qualities: [{ label: "原画", url: "/media/source" }, { label: "1080p", url: "/media/p1080" }, { label: "720p", url: "/media/p720" }] };
type Control = { name: string; html: string; selector: { html: string; default: boolean }[]; onSelect: (item: { html: string }) => Promise<string> };
const control = () => (state.options as { controls: Control[] }).controls[0];
function remember(label: string | null) {
  const storage = { getItem: vi.fn(() => label), setItem: vi.fn() };
  vi.stubGlobal("localStorage", storage); return storage;
}

it("shows no quality control when a unit has only its original", async () => {
  await mount();
  expect((state.options as { controls: unknown[] }).controls).toEqual([]);
});

it("starts on the remembered quality when the unit has it and on the original otherwise", async () => {
  remember("720p"); await mount({ source: tiers });
  expect(state.options).toMatchObject({ url: "http://localhost:6120/media/p720" });
  expect(control()).toMatchObject({ name: "quality", html: "720p", selector: [{ html: "原画", default: false }, { html: "1080p", default: false }, { html: "720p", default: true }] });
  cleanups.forEach(cleanup => cleanup?.()); state.effects.length = 0; state.refs.length = 0; state.refIndex = 0;
  remember("2160p"); await mount({ source: tiers });
  expect(state.options).toMatchObject({ url: "http://localhost:6120/media/source" }); expect(control().html).toBe("原画");
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

it("keeps watch page subtitle choices in step with a removed track without restarting the player", async () => {
  const unit: Episode = { id: "episode-unit", number: 1, seasonNumber: 1, tmdbId: 1, titleZh: "测试片", titleEn: "Test",
    overviewZh: null, overviewEn: null, runtimeMin: null, durationSeconds: 4, still: null, playable: true,
    positionSeconds: 0, completed: false, updatedAt: 0, revision: 0 };
  const work: Work = { slug: "test", kind: "movie", tmdbId: 1, titleZh: "测试片", titleEn: "Test", overviewZh: null,
    overviewEn: null, year: 2026, poster: "", code: "", seasonCount: 0, episodeCount: 1, watchedCount: 0,
    favorite: false, seasons: [], units: [unit] };
  const loaderData = { work, unit, source, previous: "", next: "", reportInterval: 15 as const };
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
    overviewZh: null, overviewEn: null, runtimeMin: null, durationSeconds: 4, still: null, playable: true, positionSeconds: 0, completed: false, updatedAt: 0, revision: 0 });
  const first = episode("episode-unit", 1), second = episode("episode-two", 2);
  const work: Work = { slug: "series", kind: "series", tmdbId: 1, titleZh: "虚构勘测队", titleEn: "Fictional Survey", overviewZh: null, overviewEn: null, year: 2026,
    poster: "", code: "", seasonCount: 1, episodeCount: 2, watchedCount: 0, favorite: false, seasons: [{ id: "season", number: 1, episodes: [first, second] }], units: [first, second] };
  const view = (unit: Episode, previous?: string, next?: string) => {
    const loaderData = { work, unit, source, previous, next, reportInterval: 15 as const };
    const page = Watch({ loaderData, params: { id: unit.id }, matches: [] as never });
    state.pageIndex = 0;
    const tree = (page.type as (props: typeof page.props) => ReactNode)(page.props);
    state.pageIndex = null;
    return elements(tree, Player)[0].props as Parameters<typeof Player>[0];
  };
  let player = view(first, undefined, second.id);
  expect(player.autoplay).toBe(false); expect(player.children).toBeFalsy();
  player.onEnded!();
  player = view(first, undefined, second.id);
  const prompt = player.children as ReactElement<{ unit: Episode; onCancel: () => void }>;
  expect(prompt.props.unit).toBe(second);
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
  const unit: Episode = { id: "episode-unit", number: 1, seasonNumber: 1, tmdbId: 1, titleZh: "虚构第 1 集", titleEn: null, overviewZh: null, overviewEn: null,
    runtimeMin: null, durationSeconds: 4, still: null, playable: true, positionSeconds: 0, completed: false, updatedAt: 0, revision: 0 };
  const work: Work = { slug: "series", kind: "series", tmdbId: 1, titleZh: "虚构勘测队", titleEn: "Fictional Survey", overviewZh: null, overviewEn: null, year: 2026,
    poster: "", code: "", seasonCount: 1, episodeCount: 1, watchedCount: 0, favorite: false, seasons: [{ id: "season", number: 1, episodes: [unit] }], units: [unit] };
  const movie = { id: "movie-unit", completed: false, poster: "", label: "电影", title: "测试信号" };
  const view = (queue: { id: string; title: string; next: typeof movie | null }) => {
    const loaderData = { work, unit, source, previous: undefined, next: undefined, reportInterval: 15 as const, queue };
    const page = Watch({ loaderData, params: { id: unit.id }, matches: [] as never });
    state.pageIndex = 0;
    const tree = (page.type as (props: typeof page.props) => ReactNode)(page.props);
    state.pageIndex = null;
    return elements(tree, Player)[0].props as Parameters<typeof Player>[0];
  };
  // The queue's next unit is offered even where the series has no natural next, and the step keeps the queue.
  let player = view({ id: "list", title: "虚构片单", next: movie });
  player.onEnded!();
  const prompt = view({ id: "list", title: "虚构片单", next: movie }).children as ReactElement<{ unit: unknown; label: string; search: string }>;
  expect(prompt.props).toMatchObject({ unit: movie, label: "片单 · 电影", search: "?playlist=list" });
  // At the queue's end the page offers the way back instead of a natural next unit or a loop.
  state.pageState.length = 0; player = view({ id: "list", title: "虚构片单", next: null });
  player.onEnded!();
  const end = view({ id: "list", title: "虚构片单", next: null }).children as ReactElement<{ playlist: { id: string } }>;
  expect(end.props.playlist).toMatchObject({ id: "list" });
});
