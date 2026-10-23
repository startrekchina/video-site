// Danmaku fixtures and in-memory store for the watch page. Everyone here is fictional and nothing
// persists: a reload regenerates the same seeded danmaku. Only the viewer's block list and display
// settings live in localStorage, as they would in the real site.
import { useSyncExternalStore } from "react"

import { hash, mulberry32, USERS } from "@/pages/watch-comments/data"

export type DanmakuMode = 0 | 1 | 2

export type Danmaku = {
  id: string
  unitId: string
  /** Seconds into the clip. */
  time: number
  text: string
  mode: DanmakuMode
  color: string
  author: string
  createdAt: number
}

export const DANMAKU_MAX_LENGTH = 50
export const DANMAKU_LOCK_SECONDS = 5
export const DANMAKU_HOURLY_LIMIT = 60
export const BLOCK_WORD_LIMIT = 20
export const BLOCK_WORD_MAX_LENGTH = 20
/** White plus four LCARS-like accents; the server would accept only these values. */
export const DANMAKU_COLORS = ["#FFFFFF", "#F2C14E", "#E5534B", "#5BA4E6", "#6CC08B", "#B48EF0"]
export const MODE_LABELS: Record<DanmakuMode, string> = { 0: "滚动", 1: "顶部", 2: "底部" }

const CLIP_SECONDS = 60
const HOUR = 3_600_000

const LINES = [
  "前方高能",
  "来了来了",
  "这配乐绝了",
  "舰长帅！",
  "Make it so 🖖",
  "Engage!",
  "红衫又要出事了",
  "数据又在学人类了",
  "这个特效放到今天也不寒碜",
  "第二遍看还是紧张",
  "抵抗是徒劳的",
  "Live long and prosper 🖖",
  "曲速九级！",
  "护盾还剩多少？",
  "斯波克的眉毛 😂",
  "我是医生，不是工程师",
  "开双语字幕更有味道",
  "全员到齐",
  "这里埋了伏笔",
  "回头看这句好感动",
  "LCARS 界面好怀旧",
  "企业号永远的神",
  "传送器又坏了",
  "Tea. Earl Grey. Hot. ☕",
  "Q 又来捣乱了",
  "这一集能看十遍",
  "打卡",
  "名场面",
  "哈哈哈哈哈",
  "泪目",
  "这段剪辑节奏真好",
  "外星人化妆好用心",
  "注意背景的细节",
  "这句台词后面还会呼应",
  "前排",
  "宇宙，最后的边疆",
  "全息甲板又失控了",
  "再给我五分钟就能修好",
  "最佳一集没有之一",
  "红色警报！",
]

function build(unitId: string, now: number): Danmaku[] {
  const rnd = mulberry32(hash(`danmaku:${unitId}`))
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
  const count = 24 + Math.floor(rnd() * 20)
  return Array.from({ length: count }, (_, i) => {
    const r = rnd()
    return {
      id: `${unitId}~${i + 1}`,
      unitId,
      time: Math.round((1 + rnd() * (CLIP_SECONDS - 3)) * 10) / 10,
      text: pick(LINES),
      mode: (r < 0.84 ? 0 : r < 0.92 ? 1 : 2) as DanmakuMode,
      color: rnd() < 0.75 ? DANMAKU_COLORS[0] : pick(DANMAKU_COLORS.slice(1)),
      author: pick(USERS),
      createdAt: now - Math.floor(rnd() * 200 * 24 * HOUR),
    }
  })
}

let state: Record<string, Danmaku[]> = {}
/** Send times per author, kept apart from the danmaku so deletions never refund the quota. */
const sendTimes: Record<string, number[]> = {}
let seq = 0
const listeners = new Set<() => void>()
const removedListeners = new Set<(unitId: string) => void>()
const emit = () => listeners.forEach((l) => l())

function ensure(unitId: string) {
  if (!state[unitId]) state = { ...state, [unitId]: build(unitId, Date.now()) }
  return state[unitId]
}

/** Unicode code points, the same count the formal app uses for comments and playlist titles. */
export const charCount = (s: string) => Array.from(s).length

export type SendResult = { ok: true; item: Danmaku } | { ok: false; reason: string }

export const danmakuActions = {
  list: (unitId: string) => ensure(unitId),
  exists: (unitId: string, id: string) => ensure(unitId).some((d) => d.id === id),
  /** Mirrors the server's checks; the player's own input limits are only a convenience. */
  send(input: { unitId: string; author: string; text: string; mode: number; color: string; time: number }): SendResult {
    const text = input.text.trim()
    if (!text || /[\r\n]/.test(text)) return { ok: false, reason: "弹幕不能为空，也不能换行。" }
    if (charCount(text) > DANMAKU_MAX_LENGTH) return { ok: false, reason: `弹幕最多 ${DANMAKU_MAX_LENGTH} 字。` }
    if (![0, 1, 2].includes(input.mode) || !DANMAKU_COLORS.includes(input.color.toUpperCase())) return { ok: false, reason: "弹幕样式无效。" }
    const now = Date.now()
    // The member-wide interval lives here: the plugin's input lock resets whenever the player is recreated.
    const times = (sendTimes[input.author] = (sendTimes[input.author] ?? []).filter((t) => now - t < HOUR))
    if (times.length && now - times[times.length - 1] < DANMAKU_LOCK_SECONDS * 1000)
      return { ok: false, reason: `发送太快了，请 ${DANMAKU_LOCK_SECONDS} 秒后再试。` }
    if (times.length >= DANMAKU_HOURLY_LIMIT) return { ok: false, reason: `每小时最多发送 ${DANMAKU_HOURLY_LIMIT} 条弹幕，请稍后再试。` }
    times.push(now)
    const item: Danmaku = {
      id: `${input.unitId}~new${++seq}`,
      unitId: input.unitId,
      time: Math.min(Math.max(input.time, 0), CLIP_SECONDS),
      text,
      mode: input.mode as DanmakuMode,
      color: input.color.toUpperCase(),
      author: input.author,
      createdAt: now,
    }
    state = { ...state, [input.unitId]: [...ensure(input.unitId), item] }
    emit()
    return { ok: true, item }
  },
  remove(unitId: string, id: string) {
    state = { ...state, [unitId]: ensure(unitId).filter((d) => d.id !== id) }
    emit()
    removedListeners.forEach((l) => l(unitId))
  },
  onRemoved(listener: (unitId: string) => void) {
    removedListeners.add(listener)
    return () => void removedListeners.delete(listener)
  },
}

export function useDanmakuList(unitId: string) {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => ensure(unitId),
  )
}

// ---- viewer-local block list ----

const BLOCK_KEY = "proto-danmaku-block"
let blocked: string[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(BLOCK_KEY) ?? "[]")
    return Array.isArray(v) ? v.filter((w) => typeof w === "string") : []
  } catch {
    return []
  }
})()
const blockListeners = new Set<() => void>()

export const getBlockedWords = () => blocked

export function isBlocked(text: string) {
  const t = text.toLowerCase()
  return blocked.some((w) => t.includes(w.toLowerCase()))
}

export function setBlockedWords(words: string[]) {
  blocked = words
  localStorage.setItem(BLOCK_KEY, JSON.stringify(words))
  blockListeners.forEach((l) => l())
}

export function subscribeBlockedWords(listener: () => void) {
  blockListeners.add(listener)
  return () => void blockListeners.delete(listener)
}

export function useBlockedWords() {
  return useSyncExternalStore(subscribeBlockedWords, getBlockedWords)
}
