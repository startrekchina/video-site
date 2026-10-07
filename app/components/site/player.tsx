import { useEffect, useRef, useState } from "react";
import type Artplayer from "artplayer";
import type { Authorization } from "@/lib/playback.server";
import { fetchAuthorization, startRenewal } from "@/lib/playback-client";
import { Button } from "@/components/ui/button";

export function Player({ unitId, authorization, csrfToken, startSeconds }: { unitId: string; authorization: Authorization; csrfToken: string; startSeconds: number }) {
  const container = useRef<HTMLDivElement>(null), retry = useRef<() => void>(() => {});
  const [message, setMessage] = useState("");
  useEffect(() => {
    let art: Artplayer | undefined, current = authorization, selected = authorization.tracks.find(track => track.language.startsWith("zh"))?.id ?? authorization.tracks[0]?.id ?? "off";
    let disposed = false, renewal: ReturnType<typeof startRenewal> | undefined;
    const absolute = (url: string) => new URL(url, location.origin).href;
    const label = (text: string) => text.replace(/[&<>"']/gu, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
    const subtitles = () => [...current.tracks.map(track => ({ html: label(track.displayName), id: track.id, default: track.id === selected })), { html: "关闭", id: "off", default: selected === "off" }];
    const changeSubtitle = async () => {
      if (!art || disposed) return;
      const track = current.tracks.find(track => track.id === selected);
      if (track) {
        await art.subtitle.switch(absolute(track.url), { name: label(track.displayName), type: "vtt", escape: true });
        if (!disposed) art.subtitle.show = true;
      } else art.subtitle.show = false;
      if (!disposed) art.setting.update({ name: "subtitle-lang", html: "字幕", selector: subtitles() });
    };
    const apply = async (next: Authorization) => {
        if (disposed || !art) return;
        const position = art.currentTime, paused = art.video.paused;
        current = next;
        if (!current.tracks.some(track => track.id === selected) && selected !== "off") selected = "off";
        await art.switchUrl(absolute(next.url));
        if (disposed) return;
        art.seek = position;
        let autoplayBlocked = false;
        if (paused) art.pause(); else await art.play().catch(() => { autoplayBlocked = true; });
        await changeSubtitle();
        setMessage(autoplayBlocked ? "浏览器未允许自动恢复，请点击播放。" : "");
    };
    retry.current = () => renewal?.retry();
    void import("artplayer").then(({ default: Artplayer }) => {
      if (disposed || !container.current) return;
      art = new Artplayer({ container: container.current, url: absolute(current.url), lang: "zh-cn", theme: "#fafafa", volume: 0.6, autoplay: false, setting: true, playbackRate: true, fullscreen: true, fullscreenWeb: true, pip: true, hotkey: true, mutex: false, backdrop: true, playsInline: true, lock: true, fastForward: true, miniProgressBar: true,
        moreVideoAttr: { preload: "metadata" }, subtitle: { url: "", type: "vtt", encoding: "utf-8", escape: true, style: { fontSize: "clamp(14px,3.2vw,28px)" } },
        settings: [{ name: "subtitle-lang", html: "字幕", selector: subtitles(), onSelect(item) { selected = String(item.id); void changeSubtitle().catch(() => setMessage("字幕暂时无法加载，请重试。")); return String(item.html); } }],
      });
      const player = art;
      player.once("ready", () => { if (startSeconds > 0 && startSeconds < player.duration) player.seek = startSeconds; });
      player.hotkey.add("KeyF", () => { player.fullscreen = !player.fullscreen; });
      player.hotkey.add("KeyM", () => { player.muted = !player.muted; });
      player.hotkey.add("KeyC", () => { const choices = [...current.tracks.map(track => track.id), "off"]; selected = choices[(choices.indexOf(selected) + 1) % choices.length]; void changeSubtitle().catch(() => setMessage("字幕暂时无法加载，请重试。")); });
      (container.current as HTMLDivElement & { art?: Artplayer }).art = player;
      void changeSubtitle().catch(() => setMessage("字幕暂时无法加载，请重试。"));
      renewal = startRenewal(authorization, signal => fetchAuthorization(unitId, csrfToken, signal), apply, () => player.pause(), setMessage);
    }).catch(() => setMessage("播放器加载失败，请刷新后重试。"));
    return () => { disposed = true; renewal?.stop(); art?.destroy(false); };
  }, [unitId]);
  return <div><div className="relative aspect-video max-h-[70svh] bg-zinc-950 text-white"><div ref={container} className="size-full" /></div>{message && <div className="flex flex-wrap items-center gap-3 p-4" role="status"><p>{message}</p><Button size="sm" onClick={() => retry.current()}>重试播放凭证</Button></div>}</div>;
}
