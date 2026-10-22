import { useEffect, useRef, useState } from "react";
import type Artplayer from "artplayer";
import type { PlaybackSource } from "@/lib/playback.server";
import { loadSubtitle, mediaErrorMessage } from "@/lib/playback-client";
import { toast } from "@/components/ui/toast";
import { saveProgress, type SavedProgress } from "@/lib/progress-client";

type Notice = { text: string; reconnect: boolean; login?: true };
// revision is shared with the page so manual marks and reports use the same expectedRevision.
export type ProgressReporting = { revision: { current: number }; interval: number; duration: number | null; onSaved: (saved: SavedProgress) => void };
// A video failure's button is the only way back, so its toast stays until the player recovers or unmounts.
// Default priority on purpose: Base UI hides high-priority toasts from assistive tech until F6 focuses them, which would hide the button.
export function noticeToast(notice: Notice, actions: { reconnect: () => void; login: () => void }): Parameters<typeof toast.add>[0] {
  const action = notice.login ? { children: "重新登录", onClick: actions.login } : notice.reconnect ? { children: "重新连接", onClick: actions.reconnect } : null;
  return action ? { title: notice.text, type: "error", timeout: 0, actionProps: action, data: { dismissible: false } } : { title: notice.text, type: "info" };
}

// autoplay tries to start once the saved start is applied; onEnded and children (an overlay on the video) serve the next-up prompt.
export function Player({ unitId, source, startSeconds, autoplay = false, progress, subtitle, onSubtitleChange, onTracksChange, onEnded, children }: { unitId: string; source: PlaybackSource; startSeconds: number; autoplay?: boolean; progress: ProgressReporting; subtitle: string; onSubtitleChange: (id: string) => void; onTracksChange: (tracks: PlaybackSource["tracks"]) => void; onEnded?: () => void; children?: React.ReactNode }) {
  const container = useRef<HTMLDivElement>(null), retry = useRef<() => void>(() => {});
  const frame = useRef<HTMLDivElement>(null), selectSubtitle = useRef<(id: string) => void>(() => {});
  // Only video failures offer reconnecting (or signing in again after 401/403); subtitle failures are retried by choosing the track again.
  const [notice, setNotice] = useState<Notice | null>(null);
  // One toast per notice: replacing or clearing the notice, or leaving the unit, closes it.
  useEffect(() => {
    if (!notice) return;
    const id = toast.add(noticeToast(notice, { reconnect: () => retry.current(), login: () => location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`) }));
    return () => toast.close(id);
  }, [notice]);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => element.style.setProperty("--player-top", `${element.getBoundingClientRect().top + window.scrollY}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element.parentElement!);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [unitId]);
  useEffect(() => {
    let art: Artplayer | undefined, tracks = source.tracks, selected = subtitle;
    // failed latches one HEAD per failure; restoreTo holds the position a reconnect returns to once.
    // ready gates position tracking: the element reports 0 before the saved start is applied.
    let disposed = false, ready = false, failed = false, playing = false, position = startSeconds, restoreTo: number | null = null;
    // shown mirrors the notice kind so a subtitle success clears only its own notice.
    type Kind = "video" | "login" | "subtitle" | "other";
    let shown: Kind | null = null;
    const windowed = () => { if (art?.fullscreen) art.fullscreen = false; if (art?.fullscreenWeb) art.fullscreenWeb = false; };
    const show = (text: string | null, kind: Kind = "other") => {
      shown = text === null ? null : kind;
      // Toasts render outside the player, out of sight in fullscreen: leave fullscreen when the notice carries a button, otherwise echo it inside the player.
      if (text !== null && art && (art.fullscreen || art.fullscreenWeb)) {
        if (kind === "video" || kind === "login") windowed();
        else art.notice.show = text;
      }
      setNotice(text === null ? null : kind === "login" ? { text, reconnect: false, login: true } : { text, reconnect: kind === "video" });
    };
    // A video failure outranks other notices until a reconnect, so its recovery button is never replaced.
    const say = (text: string, kind: Kind = "other") => { if (kind === "video" || kind === "login" || !failed) show(text, kind); };
    let subtitleJob: Promise<void> = Promise.resolve();
    const absolute = (url: string) => new URL(url, location.origin).href;
    const label = (text: string) => text.replace(/[&<>"']/gu, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
    const subtitles = () => [...tracks.map(track => ({ html: label(track.displayName), id: track.id, default: track.id === selected })), { html: "关闭", id: "off", default: selected === "off" }];
    const changeSubtitle = () => {
      const choice = selected;
      // Serialize switches so an older VTT response cannot replace the latest selection.
      subtitleJob = subtitleJob.catch(() => {}).then(async () => {
        if (!art || disposed || choice !== selected) return;
        const track = tracks.find(track => track.id === choice);
        if (track) {
          const loaded = await loadSubtitle(absolute(track.url));
          if (disposed || choice !== selected) { if ("url" in loaded) URL.revokeObjectURL(loaded.url); return; }
          // Any failure turns subtitles off, so choosing the same track again retries it.
          const fail = (message: string, remove = false) => {
            if (!art) return;
            if (remove) { tracks = tracks.filter(item => item.id !== track.id); onTracksChange(tracks); }
            selected = "off"; onSubtitleChange("off"); art.subtitle.show = false;
            art.setting.update({ name: "subtitle-lang", html: "字幕", selector: subtitles() });
            say(message, "subtitle");
          };
          if ("message" in loaded) { fail(loaded.message, loaded.remove); return; }
          try { await art.subtitle.switch(loaded.url, { name: label(track.displayName), type: "vtt", escape: true }); }
          catch { if (!disposed && choice === selected) fail("字幕加载失败，请再次选择该字幕。"); return; }
          finally { URL.revokeObjectURL(loaded.url); }
        }
        if (disposed || choice !== selected) return;
        if (shown === "subtitle") show(null);
        art.subtitle.show = Boolean(track);
        art.setting.update({ name: "subtitle-lang", html: "字幕", selector: subtitles() });
      });
      return subtitleJob;
    };
    const select = (id: string) => {
      if (id === selected) return;
      selected = id;
      onSubtitleChange(id);
      if (id === "off" && art) art.subtitle.show = false;
      void changeSubtitle().catch(() => say("字幕加载失败，请再次选择该字幕。", "subtitle"));
    };
    selectSubtitle.current = select;
    // Reports go out on an interval while the position moves, and on pause, end, hiding the page or leaving the unit; one at a time.
    // A refused (409) report is dropped, not replayed: only a later position change reports again.
    let reporting = false, reported = startSeconds;
    const report = (keepalive = false) => {
      const at = Math.min(position, progress.duration ?? position);
      if (!ready || reporting || Math.abs(at - reported) < 1) return;
      reporting = true;
      void saveProgress(unitId, { positionSeconds: at }, progress.revision.current, keepalive).then(result => {
        reporting = false;
        if ("saved" in result) { progress.revision.current = result.saved.revision; reported = at; progress.onSaved(result.saved); }
        else if ("conflict" in result) { progress.revision.current = result.conflict; reported = at; }
      });
    };
    const timer = setInterval(() => report(), progress.interval * 1000);
    const hidden = () => { if (document.visibilityState === "hidden") report(true); }, leave = () => report(true);
    document.addEventListener("visibilitychange", hidden); window.addEventListener("pagehide", leave);
    // The recovery canplay handler below restores the position and the play state.
    retry.current = () => { if (art && !disposed) { failed = false; restoreTo = position; show(null); art.url = absolute(source.url); } };
    void import("artplayer").then(({ default: Artplayer }) => {
      if (disposed || !container.current) return;
      // ArtPlayer's own reconnects restart at 0 and, with cached leading bytes, can loop forever; the reconnect button is the only recovery path.
      Artplayer.RECONNECT_TIME_MAX = 0;
      art = new Artplayer({ container: container.current, url: absolute(source.url), lang: "zh-cn", theme: "#fafafa", volume: 0.6, autoplay: false, setting: true, playbackRate: true, fullscreen: true, fullscreenWeb: true, pip: true, hotkey: true, mutex: false, backdrop: true, playsInline: true, lock: true, fastForward: true, miniProgressBar: true,
        moreVideoAttr: { preload: "metadata" }, subtitle: { url: "", type: "vtt", encoding: "utf-8", escape: true, style: { fontSize: "clamp(14px,3.2cqw,28px)" } },
        settings: [{ name: "subtitle-lang", html: "字幕", selector: subtitles(), onSelect(item) { select(String(item.id)); return String(item.html); } }],
      });
      const player = art;
      player.once("ready", () => {
        if (startSeconds > 0 && startSeconds < player.duration) player.seek = startSeconds;
        position = player.currentTime; ready = true;
        if (autoplay) void player.play().catch(() => say("浏览器阻止自动播放，请点击播放。"));
      });
      player.hotkey.add("KeyF", () => { player.fullscreen = !player.fullscreen; });
      player.hotkey.add("KeyM", () => { player.muted = !player.muted; });
      player.hotkey.add("KeyC", () => { const choices = [...tracks.map(track => track.id), "off"]; select(choices[(choices.indexOf(selected) + 1) % choices.length]); });
      // ArtPlayer retries the same URL by itself; classify each failure once so the message names the cause.
      player.on("video:error", async () => {
        // A failed reconnect ends its attempt; a later cached canplay must not seek into the missing range.
        restoreTo = null;
        if (failed || disposed) return;
        failed = true;
        const status = await fetch(absolute(source.url), { method: "HEAD", credentials: "same-origin", cache: "no-store" }).then(response => response.status, () => 0);
        if (!disposed && failed) say(mediaErrorMessage(status), status === 401 || status === 403 ? "login" : "video");
      });
      // Pauses caused by a failure or a reconnect reload are not the member's choice.
      player.on("video:play", () => { playing = true; });
      player.on("video:pause", () => { if (!failed && restoreTo === null) { playing = false; report(); } });
      // The next-up prompt lives in the page, outside the fullscreen element; the next unit would leave fullscreen anyway.
      player.on("video:ended", () => { report(); if (onEnded) { windowed(); onEnded(); } });
      player.on("video:timeupdate", () => { if (ready && !failed && restoreTo === null) position = player.currentTime; });
      // Restore once per reconnect; if the restored range fails again, the error is classified and offered again.
      player.on("video:canplay", () => {
        if (restoreTo === null) return;
        const target = restoreTo; restoreTo = null;
        if (Math.abs(player.currentTime - target) > 1) player.currentTime = target;
        if (playing) void player.play().catch(() => say("浏览器阻止自动播放，请点击播放。"));
      });
      (container.current as HTMLDivElement & { art?: Artplayer }).art = player;
      void changeSubtitle().catch(() => say("字幕加载失败，请再次选择该字幕。", "subtitle"));
    }).catch(() => say("播放器加载失败，请刷新页面。"));
    return () => {
      report(true); clearInterval(timer); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", leave);
      disposed = true; selectSubtitle.current = () => {}; art?.destroy(false);
    };
  }, [unitId]);
  useEffect(() => selectSubtitle.current(subtitle), [subtitle]);
  return <div ref={frame} data-slot="player-frame" className="screen-line-top screen-line-bottom relative z-[41] bg-black text-white [--player-bottom:calc(3.5rem+env(safe-area-inset-bottom,0px))] sm:[--player-bottom:calc(1rem+env(safe-area-inset-bottom,0px))]"><div className="player-surface relative aspect-video w-full max-h-[max(6rem,100svh-var(--player-top,15rem)-var(--player-bottom))]"><div ref={container} className="size-full" />{children}</div></div>;
}
