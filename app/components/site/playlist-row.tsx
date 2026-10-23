import { GlobeIcon, LockIcon } from "lucide-react";
import { Link } from "react-router";
import type { playlists } from "@/lib/library.server";
import { Poster } from "@/components/site/media";
import { Tag } from "@/components/ui/tag";
type Visibility = "private" | "members";
export function VisibilityTag({ visibility }: { visibility: Visibility }) {
  return <Tag className="gap-1">{visibility === "members" ? <GlobeIcon /> : <LockIcon />}{visibility === "members" ? "站内公开" : "私有"}</Tag>;
}
export function PlaylistRow({ playlist }: { playlist: Awaited<ReturnType<typeof playlists>>[number] }) {
  return <li className="relative flex items-center gap-4 p-4 transition-[background-color] ease-out hover:bg-accent-muted"><div className="relative h-16 w-20 shrink-0">{playlist.posters.length === 0 && <div className="size-full rounded border border-dashed" />}{playlist.posters.map((src, i) => <div key={i} className="absolute top-0 w-11" style={{ left: i * 10, zIndex: 4 - i }}><Poster src={src} alt="" className="shadow-sm" /></div>)}</div>
    <div className="min-w-0 flex-1"><Link to={`/playlists/${playlist.id}`} className="font-medium after:absolute after:inset-0">{playlist.title}</Link><div className="mt-1 flex items-center gap-2 font-mono text-xs text-muted-foreground"><VisibilityTag visibility={playlist.visibility} /><span>{playlist.count} 项</span><span>· {playlist.owner}</span><span className="max-sm:hidden">· 更新于 {new Date(playlist.updatedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}</span></div></div></li>;
}
