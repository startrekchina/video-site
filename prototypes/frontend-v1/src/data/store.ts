// In-memory prototype state. Nothing persists: a reload resets to the selected scenario.
// All people here are fictional.
import { useSyncExternalStore } from "react"

import { getUnit, nextUnit, WORKS } from "./catalog"

export type Role = "member" | "admin"

export type Member = {
  id: string
  username: string
  role: Role
  status: "active" | "banned"
  invitedBy: string | null
  joinedAt: string
  inviteQuota: number
  lastSeen: string
}

export type InviteCode = {
  code: string
  issuer: string
  status: "unused" | "used" | "revoked" | "expired"
  usedBy: string | null
  createdAt: string
  expiresAt: string
}

export type Progress = { positionSec: number; durationSec: number; updatedAt: number; watched: boolean }

export type PlaylistItem = { type: "work"; slug: string } | { type: "unit"; id: string }

export type Playlist = {
  id: string
  title: string
  description: string
  owner: string
  visibility: "private" | "public"
  items: PlaylistItem[]
  updatedAt: string
}

export type SessionInfo = { id: string; device: string; location: string; lastActive: string; current: boolean }

export type Scenario = "guest" | "member" | "admin" | "new-member"

type State = {
  scenario: Scenario
  me: Member | null
  members: Member[]
  invites: InviteCode[]
  progress: Record<string, Progress>
  favorites: string[]
  playlists: Playlist[]
  sessions: SessionInfo[]
  passkeys: { id: string; name: string; createdAt: string }[]
  totpEnabled: boolean
  recoveryCodesLeft: number
  loginFailures: number
}

const WATCH_THRESHOLD = 0.9

const MEMBERS: Member[] = [
  { id: "u1", username: "station_keeper", role: "admin", status: "active", invitedBy: null, joinedAt: "2026-06-01", inviteQuota: Infinity, lastSeen: "刚刚" },
  { id: "u2", username: "picard_fan", role: "member", status: "active", invitedBy: "u1", joinedAt: "2026-06-03", inviteQuota: 2, lastSeen: "5 分钟前" },
  { id: "u3", username: "tribble_42", role: "member", status: "active", invitedBy: "u2", joinedAt: "2026-06-10", inviteQuota: 2, lastSeen: "昨天" },
  { id: "u4", username: "ops_ensign", role: "admin", status: "active", invitedBy: "u1", joinedAt: "2026-06-04", inviteQuota: Infinity, lastSeen: "3 小时前" },
  { id: "u5", username: "holodeck_err", role: "member", status: "banned", invitedBy: "u3", joinedAt: "2026-07-12", inviteQuota: 2, lastSeen: "8 月 2 日" },
  { id: "u6", username: "warp_nine", role: "member", status: "active", invitedBy: "u2", joinedAt: "2026-07-20", inviteQuota: 3, lastSeen: "2 天前" },
  { id: "u7", username: "quark_bar", role: "member", status: "active", invitedBy: "u6", joinedAt: "2026-08-15", inviteQuota: 2, lastSeen: "1 周前" },
  { id: "u8", username: "sickbay_doc", role: "member", status: "active", invitedBy: "u4", joinedAt: "2026-09-02", inviteQuota: 2, lastSeen: "今天" },
  { id: "u9", username: "new_cadet", role: "member", status: "active", invitedBy: "u2", joinedAt: "2026-09-30", inviteQuota: 2, lastSeen: "刚刚" },
]

function daysAgo(d: number) {
  return Date.now() - d * 86400_000
}

function seedProgress(): Record<string, Progress> {
  const p: Record<string, Progress> = {}
  const set = (id: string, frac: number, ago: number) => {
    const u = getUnit(id)
    if (!u) return
    const dur = u.runtimeMin * 60
    p[id] = { positionSec: Math.round(dur * frac), durationSec: dur, updatedAt: daysAgo(ago), watched: frac >= WATCH_THRESHOLD }
  }
  for (let e = 1; e <= 25; e++) set(`tng-s03e${String(e).padStart(2, "0")}`, 1, 10 - e * 0.3)
  set("tng-s03e26", 0.42, 0.1)
  set("movie-star-trek-ii-the-wrath-of-khan", 0.63, 1)
  for (let e = 1; e <= 6; e++) set(`snw-s01e${String(e).padStart(2, "0")}`, 1, 4 - e * 0.1)
  set("snw-s01e07", 0.95, 3.2)
  set("ds9-s01e03", 0.18, 6)
  set("ld-s02e04", 0.71, 2)
  return p
}

const PLAYLISTS: Playlist[] = [
  {
    id: "p1",
    title: "TNG 必看 20 集",
    description: "新人入坑用，按播出顺序。",
    owner: "picard_fan",
    visibility: "public",
    items: [
      { type: "unit", id: "tng-s03e15" },
      { type: "unit", id: "tng-s03e26" },
      { type: "unit", id: "tng-s04e01" },
      { type: "unit", id: "tng-s02e09" },
      { type: "unit", id: "tng-s05e25" },
      { type: "unit", id: "tng-s06e10" },
      { type: "work", slug: "star-trek-first-contact" },
    ],
    updatedAt: "2026-09-12",
  },
  {
    id: "p2",
    title: "周末电影马拉松",
    description: "",
    owner: "picard_fan",
    visibility: "private",
    items: [
      { type: "work", slug: "star-trek-ii-the-wrath-of-khan" },
      { type: "work", slug: "star-trek-vi-the-undiscovered-country" },
      { type: "work", slug: "star-trek-first-contact" },
    ],
    updatedAt: "2026-09-25",
  },
  {
    id: "p3",
    title: "DS9 自治领战争线",
    description: "只看主线，跳过单元剧。",
    owner: "tribble_42",
    visibility: "public",
    items: [
      { type: "work", slug: "star-trek-deep-space-nine" },
      { type: "unit", id: "ds9-s02e26" },
      { type: "unit", id: "ds9-s05e26" },
      { type: "unit", id: "ds9-s06e01" },
    ],
    updatedAt: "2026-08-30",
  },
]

const INVITES: InviteCode[] = [
  { code: "ENGAGE-7Q4M-K2PX", issuer: "picard_fan", status: "used", usedBy: "warp_nine", createdAt: "2026-07-18", expiresAt: "2026-08-01" },
  { code: "MAKEIT-SO9-3HDR", issuer: "picard_fan", status: "used", usedBy: "new_cadet", createdAt: "2026-09-28", expiresAt: "2026-10-12" },
  { code: "WARP-F8TZ-11NB", issuer: "picard_fan", status: "revoked", usedBy: null, createdAt: "2026-08-02", expiresAt: "2026-08-16" },
  { code: "BORG-X0X0-7777", issuer: "tribble_42", status: "expired", usedBy: null, createdAt: "2026-07-01", expiresAt: "2026-07-15" },
  { code: "Q-CONT-INUM-01", issuer: "station_keeper", status: "unused", usedBy: null, createdAt: "2026-09-29", expiresAt: "2026-10-13" },
]

function initial(scenario: Scenario): State {
  const base: State = {
    scenario,
    me: null,
    members: MEMBERS.map((m) => ({ ...m })),
    invites: INVITES.map((i) => ({ ...i })),
    progress: {},
    favorites: [],
    playlists: [],
    sessions: [],
    passkeys: [],
    totpEnabled: false,
    recoveryCodesLeft: 10,
    loginFailures: 0,
  }
  if (scenario === "guest") return base
  const me = scenario === "admin" ? MEMBERS[0] : scenario === "new-member" ? MEMBERS[8] : MEMBERS[1]
  const seeded = scenario !== "new-member"
  return {
    ...base,
    me: { ...me },
    progress: seeded ? seedProgress() : {},
    favorites: seeded ? ["star-trek-the-next-generation", "star-trek-strange-new-worlds", "star-trek-ii-the-wrath-of-khan", "star-trek-deep-space-nine"] : [],
    playlists: seeded ? PLAYLISTS.map((p) => ({ ...p, items: [...p.items], owner: p.owner === "picard_fan" ? me.username : p.owner })) : PLAYLISTS.filter((p) => p.visibility === "public" && p.owner !== "picard_fan").map((p) => ({ ...p })),
    sessions: [
      { id: "s1", device: "Chrome · Windows", location: "上海", lastActive: "当前会话", current: true },
      ...(seeded
        ? [
            { id: "s2", device: "Safari · iPhone", location: "上海", lastActive: "2 小时前", current: false },
            { id: "s3", device: "Firefox · Linux", location: "法兰克福", lastActive: "6 天前", current: false },
          ]
        : []),
    ],
    passkeys: seeded ? [{ id: "k1", name: "iCloud 钥匙串", createdAt: "2026-06-05" }] : [],
    totpEnabled: seeded,
    recoveryCodesLeft: seeded ? 7 : 10,
  }
}

let state: State = initial((sessionStorage.getItem("proto-scenario") as Scenario) || "member")
const listeners = new Set<() => void>()

function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

const getSnapshot = () => state

/** Subscribes to the whole state (stable snapshot) and derives in render, so selectors may return fresh arrays. */
export function useStore<T>(selector: (s: State) => T): T {
  return selector(useSyncExternalStore(subscribe, getSnapshot))
}

export const getState = () => state

function randomCode() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const part = (n: number) => Array.from({ length: n }, () => a[Math.floor(Math.random() * a.length)]).join("")
  return `${part(4)}-${part(4)}-${part(4)}`
}

export const actions = {
  setScenario(s: Scenario) {
    // The scenario (not the data) survives reloads so the prototype console choice sticks.
    sessionStorage.setItem("proto-scenario", s)
    state = initial(s)
    listeners.forEach((l) => l())
  },
  login() {
    set({ ...initial("member"), scenario: "member" })
    sessionStorage.setItem("proto-scenario", "member")
  },
  logout() {
    actions.setScenario("guest")
  },
  registerAs(username: string) {
    const s = initial("new-member")
    s.me = { ...s.me!, username }
    sessionStorage.setItem("proto-scenario", "new-member")
    state = s
    listeners.forEach((l) => l())
  },
  failLogin() {
    set((s) => ({ loginFailures: s.loginFailures + 1 }))
  },
  reportProgress(unitId: string, positionSec: number, durationSec: number) {
    set((s) => {
      const prev = s.progress[unitId]
      const watched = prev?.watched || positionSec / durationSec >= WATCH_THRESHOLD
      return { progress: { ...s.progress, [unitId]: { positionSec, durationSec, updatedAt: Date.now(), watched } } }
    })
  },
  setWatched(unitId: string, watched: boolean) {
    const u = getUnit(unitId)
    if (!u) return
    set((s) => {
      const dur = s.progress[unitId]?.durationSec ?? u.runtimeMin * 60
      return { progress: { ...s.progress, [unitId]: { positionSec: watched ? dur : 0, durationSec: dur, updatedAt: Date.now(), watched } } }
    })
  },
  toggleFavorite(slug: string) {
    set((s) => ({ favorites: s.favorites.includes(slug) ? s.favorites.filter((f) => f !== slug) : [slug, ...s.favorites] }))
  },
  createPlaylist(title: string, visibility: Playlist["visibility"]) {
    const id = `p${Date.now()}`
    set((s) => ({
      playlists: [{ id, title, description: "", owner: s.me!.username, visibility, items: [], updatedAt: "刚刚" }, ...s.playlists],
    }))
    return id
  },
  addToPlaylist(id: string, item: PlaylistItem) {
    set((s) => ({
      playlists: s.playlists.map((p) =>
        p.id === id && !p.items.some((i) => JSON.stringify(i) === JSON.stringify(item)) ? { ...p, items: [...p.items, item], updatedAt: "刚刚" } : p,
      ),
    }))
  },
  moveItem(id: string, from: number, to: number) {
    set((s) => ({
      playlists: s.playlists.map((p) => {
        if (p.id !== id || to < 0 || to >= p.items.length) return p
        const items = [...p.items]
        const [x] = items.splice(from, 1)
        items.splice(to, 0, x)
        return { ...p, items }
      }),
    }))
  },
  removeItem(id: string, index: number) {
    set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...p, items: p.items.filter((_, i) => i !== index) } : p)) }))
  },
  setVisibility(id: string, visibility: Playlist["visibility"]) {
    set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...p, visibility } : p)) }))
  },
  deletePlaylist(id: string) {
    set((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) }))
  },
  createInvite() {
    const code = randomCode()
    set((s) => ({
      invites: [{ code, issuer: s.me!.username, status: "unused", usedBy: null, createdAt: "2026-09-30", expiresAt: "2026-10-14" }, ...s.invites],
    }))
    return code
  },
  revokeInvite(code: string) {
    set((s) => ({ invites: s.invites.map((i) => (i.code === code ? { ...i, status: "revoked" } : i)) }))
  },
  revokeSession(id: string) {
    set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) }))
  },
  revokeOtherSessions() {
    set((s) => ({ sessions: s.sessions.filter((x) => x.current) }))
  },
  addPasskey(name: string) {
    set((s) => ({ passkeys: [...s.passkeys, { id: `k${Date.now()}`, name, createdAt: "2026-09-30" }] }))
  },
  removePasskey(id: string) {
    set((s) => ({ passkeys: s.passkeys.filter((k) => k.id !== id) }))
  },
  setTotp(on: boolean) {
    set({ totpEnabled: on })
  },
  regenerateRecoveryCodes() {
    set({ recoveryCodesLeft: 10 })
  },
  ban(memberId: string, cascade: boolean) {
    set((s) => {
      const ids = new Set([memberId])
      if (cascade) {
        let grew = true
        while (grew) {
          grew = false
          for (const m of s.members)
            if (m.invitedBy && ids.has(m.invitedBy) && !ids.has(m.id)) {
              ids.add(m.id)
              grew = true
            }
        }
      }
      return { members: s.members.map((m) => (ids.has(m.id) ? { ...m, status: "banned" } : m)) }
    })
  },
  unban(memberId: string) {
    set((s) => ({ members: s.members.map((m) => (m.id === memberId ? { ...m, status: "active" } : m)) }))
  },
  setRole(memberId: string, role: Role) {
    set((s) => ({ members: s.members.map((m) => (m.id === memberId ? { ...m, role, inviteQuota: role === "admin" ? Infinity : 2 } : m)) }))
  },
  setQuota(memberId: string, quota: number) {
    set((s) => ({ members: s.members.map((m) => (m.id === memberId ? { ...m, inviteQuota: quota } : m)) }))
  },
}

/** "Continue watching": unfinished units by recency; for finished episodes, suggest the next one. */
export function continueWatching(s: State) {
  const seenWorks = new Set<string>()
  const out: { unitId: string; progress: Progress | null; reason: "resume" | "next" }[] = []
  const entries = Object.entries(s.progress).sort((a, b) => b[1].updatedAt - a[1].updatedAt)
  for (const [id, p] of entries) {
    const u = getUnit(id)
    if (!u || seenWorks.has(u.work.slug)) continue
    seenWorks.add(u.work.slug)
    if (!p.watched) out.push({ unitId: id, progress: p, reason: "resume" })
    else {
      const n = nextUnit(id)
      if (n && !s.progress[n.id]?.watched) out.push({ unitId: n.id, progress: s.progress[n.id] ?? null, reason: "next" })
    }
  }
  return out
}

export function workProgress(s: State, slug: string) {
  const w = WORKS.find((x) => x.slug === slug)
  if (!w) return { watched: 0, total: 0 }
  if (w.kind === "movie") return { watched: s.progress[w.unitId!]?.watched ? 1 : 0, total: 1 }
  let watched = 0
  let total = 0
  for (const season of w.seasons)
    for (const e of season.episodes) {
      total++
      if (s.progress[e.id]?.watched) watched++
    }
  return { watched, total }
}

export function inviteQuotaLeft(s: State) {
  if (!s.me) return 0
  if (s.me.role === "admin") return Infinity
  const used = s.invites.filter((i) => i.issuer === s.me!.username && i.status !== "revoked").length
  return Math.max(0, s.me.inviteQuota - used)
}
