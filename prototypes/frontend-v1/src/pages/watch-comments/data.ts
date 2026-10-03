// Comment fixtures and in-memory store for the watch-page discussion. Everyone here is fictional and
// nothing persists: a reload regenerates the same seeded threads.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react"

import { getUnit } from "@/data/catalog"
import { useStore } from "@/data/store"

export type Comment = {
  id: string
  unitId: string
  /** Posting order among siblings; only used to mint ids. */
  seq: number
  parentId: string | null
  /** Reply to a reply: the author being answered. Threads stay two levels deep. */
  replyTo: string | null
  author: string
  body: string
  createdAt: number
  /** Votes from other members; the viewer's own vote lives in `votes`. */
  likes: number
  /** Never shown, only feeds the smart sort. */
  dislikes: number
  /** Posted in this session: pinned to the top of page one for its author. */
  fresh?: boolean
}

export type Vote = 1 | -1
export type SortKey = "smart" | "new" | "old"

export const MAX_LENGTH = 1000
export const PAGE_SIZE = 10
export const REPLY_BATCH = 10

export const DEMO_UNIT = "tng-s03e26"
export const EMPTY_UNIT = "tng-s03e24"

export const ADMINS = new Set(["station_keeper", "ops_ensign"])

const USERS = [
  "station_keeper",
  "ops_ensign",
  "picard_fan",
  "tribble_42",
  "warp_nine",
  "quark_bar",
  "sickbay_doc",
  "new_cadet",
  "data_lore",
  "jefferies_tube",
  "borg_cube_7",
  "risa_sunset",
  "guinan_tea",
  "tenforward",
  "redshirt_03",
  "dilithium",
  "vulcan_logic",
  "holo_novel",
  "subspace_echo",
  "tricorder",
  "gorn_again",
  "ferengi_ledger",
  "nacelle",
  "lcars_ui",
  "earl_grey_hot",
  "spot_the_cat",
]

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

type Seed = { author: string; ago: number; body: string; likes: number; dislikes?: number; replies?: ReplySeed[]; extra?: number }
type ReplySeed = { author: string; body: string; replyTo?: string; likes?: number }

// Hand-written thread for the demo episode (TNG S03E26). `ago` is in minutes.
const DEMO: Seed[] = [
  {
    author: "guinan_tea",
    ago: 410 * 1440,
    body: "> Mr. Worf… fire.\n\n这句台词配上那段配乐，几十年了还是起鸡皮疙瘩。",
    likes: 86,
    replies: [
      { author: "warp_nine", body: "每次重看到这里都会暂停一下，缓一缓再按播放。", likes: 12 },
      { author: "tribble_42", body: "配乐是 Ron Jones 写的，**整张原声带**都值得听。", likes: 9 },
      { author: "quark_bar", body: "当年我是录像带看的，倒带看了五遍 😂", likes: 6 },
      { author: "guinan_tea", body: "录像带党握手 🤝", replyTo: "quark_bar", likes: 3 },
      { author: "data_lore", body: "这一幕的镜头是慢慢推近莱克的脸，导演很懂。" },
      { author: "vulcan_logic", body: "从逻辑上讲，这一炮打出去之前大家就知道没用。但情绪上必须打。", likes: 4 },
      { author: "redshirt_03", body: "+1" },
      { author: "holo_novel", body: "我更喜欢下一集开头这句的回响。" },
      { author: "sickbay_doc", body: "> 几十年了还是起鸡皮疙瘩\n\n真的，刚刚又起了一次。", likes: 2 },
      { author: "nacelle", body: "看评论才知道这么多人和我一样 🖖" },
      { author: "lcars_ui", body: "建议开英文字幕再看一遍这一段，原声的停顿更有味道。", likes: 5 },
      { author: "spot_the_cat", body: "我妈在旁边问：所以打中了吗？" },
      { author: "warp_nine", body: "哈哈哈哈哈你妈妈好可爱", replyTo: "spot_the_cat" },
      { author: "tenforward", body: "这就是为什么 TNG 第三季是起飞的一季。" },
      { author: "gorn_again", body: "楼上说得对。" },
      { author: "borg_cube_7", body: "作为博格人，我表示：抵抗是徒劳的。", likes: 7 },
      { author: "ferengi_ledger", body: "笑死，你的用户名 🤣", replyTo: "borg_cube_7" },
      { author: "subspace_echo", body: "当年等这一下等了一个夏天。" },
      { author: "dilithium", body: "顶上去，让新人看到。" },
      { author: "earl_grey_hot", body: "Tea. Earl Grey. Hot. ☕ 看完这段需要冷静一下。", likes: 3 },
      { author: "jefferies_tube", body: "画面上那道光束的特效放到今天也不寒碜。" },
      { author: "tricorder", body: "收藏这条评论，下次重看再来。" },
      { author: "new_cadet", body: "刚补到这里，原来就是这句！" },
    ],
  },
  {
    author: "picard_fan",
    ago: 395 * 1440,
    body: "当年首播完要**等一整个夏天**才能看到下集，现在的观众很难体会这种折磨 😭",
    likes: 64,
    replies: [
      { author: "subspace_echo", body: "那时候论坛上每天都在猜皮卡德会不会死。", likes: 8 },
      { author: "tribble_42", body: "我是后来补的，直接点了下一集，幸福。" },
      { author: "picard_fan", body: "羡慕 😂", replyTo: "tribble_42" },
      { author: "risa_sunset", body: "这就是“季末悬念”这个词的起源吧？" },
      { author: "vulcan_logic", body: "不完全是，但这集确实把它带火了。", replyTo: "risa_sunset", likes: 2 },
    ],
  },
  {
    author: "data_lore",
    ago: 340 * 1440,
    body: "第一次见到 Locutus 的那个镜头，皮卡德转过身来——那一下我是真的被吓到了。",
    likes: 52,
    replies: [{ author: "borg_cube_7", body: "化妆和灯光都是满分。", likes: 4 }],
  },
  {
    author: "vulcan_logic",
    ago: 300 * 1440,
    body: "雪莱少校这个角色写得真好，和莱克的对手戏张力拉满。她不是反派，只是太想证明自己了。",
    likes: 41,
    replies: [
      { author: "sickbay_doc", body: "后来在 LD 里客串了一下，可惜戏份太少。" },
      { author: "warp_nine", body: "同意，她的野心是合理的。", likes: 3 },
    ],
  },
  {
    author: "tenforward",
    ago: 250 * 1440,
    body: "重看笔记：\n\n1. 博格立方体的模型在 1990 年算是顶级水平\n2. 莱克三次拒绝升任舰长，这集终于把这个问题摆到台面上\n3. 桂南和皮卡德那场谈话，*“没有人能代替你”*，后面全靠这句撑着\n4. 汉森少将的戏份不多，但每句话都在推剧情\n5. 片尾推镜头 + To be continued，教科书级别的悬念\n\n下集见。",
    likes: 37,
    replies: [{ author: "guinan_tea", body: "第 3 点 🙏 那场戏是我最喜欢的。", likes: 5 }],
  },
  {
    author: "jefferies_tube",
    ago: 200 * 1440,
    body: "有没有人注意到，博格人那句 `Resistance is futile.` 第一次出现就是这集？之后成了整个系列的梗。",
    likes: 33,
    replies: [
      { author: "lcars_ui", body: "是的，之后每部剧都要致敬一次。" },
      { author: "borg_cube_7", body: "我的用户名就是这么来的。", likes: 6 },
    ],
  },
  {
    author: "sickbay_doc",
    ago: 150 * 1440,
    body: "求推荐：看完这两集之后，还有哪些博格相关的单集值得看？",
    likes: 28,
    replies: [
      { author: "tribble_42", body: "《Q 是谁》（第 2 季第 16 集），博格第一次出场，必看。", likes: 11 },
      { author: "quark_bar", body: "电影《第一类接触》，不用犹豫。", likes: 14 },
      { author: "vulcan_logic", body: "《我，博格》（第 5 季第 23 集），视角很特别。", likes: 8 },
      { author: "holo_novel", body: "VOY 后几季博格戏份很多，口碑见仁见智。" },
      { author: "warp_nine", body: "PIC 第三季的结尾也算。", likes: 3 },
      { author: "sickbay_doc", body: "谢谢各位，已经加进片单了 🙏" },
      { author: "picard_fan", body: "我整理过一个片单：[TNG 必看 20 集](/playlists/p1)，里面有这几集。", likes: 9 },
      { author: "sickbay_doc", body: "太好了，收藏了。", replyTo: "picard_fan" },
      { author: "nacelle", body: "补充一个：《家族》（第 4 季第 2 集），讲皮卡德被同化之后怎么面对自己。", likes: 6 },
      { author: "risa_sunset", body: "这个是真的好，安静但很有力量。", replyTo: "nacelle" },
      { author: "gorn_again", body: "DS9 第一集也和这场战役有关！" },
      { author: "tenforward", body: "对，西斯科就是在这场战役里失去了妻子。", replyTo: "gorn_again", likes: 4 },
    ],
  },
  { author: "risa_sunset", ago: 120 * 1440, body: "第三季真的是 TNG 起飞的一季，从《昨日企业号》到这集，一路高能。", likes: 24 },
  {
    author: "quark_bar",
    ago: 90 * 1440,
    body: "莱克：我在企业号上待得太舒服了。\n雪莱：那你就该让位。\n\n~~职场剧~~ 太真实了。",
    likes: 22,
    replies: [{ author: "ferengi_ledger", body: "按获取法则第 34 条，战争有利于生意。和这集没关系，我就是想说。", likes: 2 }],
  },
  { author: "borg_cube_7", ago: 60 * 1440, body: "博格立方体切下一块殖民地的那个画面，放到今天看依然很有压迫感。", likes: 19 },
  { author: "holo_novel", ago: 40 * 1440, body: "数据在这集几乎没什么戏份，有点可惜。", likes: 6, dislikes: 9, replies: [{ author: "data_lore", body: "下一集有的，别急。", likes: 5 }] },
  {
    author: "station_keeper",
    ago: 23 * 1440,
    body: "这一集换上了重新校对过的中文字幕，有错漏可以直接在这里回复，我会统一修正。",
    likes: 31,
    replies: [
      { author: "lcars_ui", body: "辛苦了！第 12 分钟左右 *Shelby* 的译名前后不一致。", likes: 3 },
      { author: "station_keeper", body: "收到，已经改成“雪莱”。", replyTo: "lcars_ui", likes: 4 },
    ],
  },
  { author: "nacelle", ago: 15 * 1440, body: "片尾那个推镜头 + To be continued，教科书级别的悬念。", likes: 14 },
  { author: "gorn_again", ago: 9 * 1440, body: "**剧透预警**：下一集的处理我一直觉得有点仓促，但这集本身是满分。", likes: 11, dislikes: 2 },
  { author: "redshirt_03", ago: 6 * 1440, body: "第一次看 TNG 就是从这两集入的坑，之后才回头补前两季。", likes: 8 },
  { author: "earl_grey_hot", ago: 3.5 * 1440, body: "汉森少将那句“这是你这辈子最重要的决定”，说给莱克也说给观众 😮", likes: 7 },
  {
    author: "dilithium",
    ago: 2 * 1440,
    body: "反派写得太单薄了，博格就是一群没有面孔的怪物，动机说不通。",
    likes: 5,
    dislikes: 18,
    replies: [
      { author: "vulcan_logic", body: "没有面孔恰恰是设计意图：它们代表的是“被吞没”的恐惧本身。", likes: 13 },
      { author: "dilithium", body: "这个角度我没想过，收回一半。", replyTo: "vulcan_logic", likes: 6 },
    ],
  },
  {
    author: "spot_the_cat",
    ago: 1100,
    body: "我妈当年看完这集问我皮卡德是不是真的要死了 🤣",
    likes: 9,
    replies: [
      { author: "quark_bar", body: "然后你怎么回答的？" },
      { author: "spot_the_cat", body: "我说：下集见。", replyTo: "quark_bar", likes: 4 },
    ],
  },
  { author: "subspace_echo", ago: 300, body: "企业号的内景灯光在这集特别暗，导演是故意营造压迫感吧？", likes: 3 },
  { author: "lcars_ui", ago: 140, body: "整理了一份博格线的观看顺序，放在片单里了：[TNG 必看 20 集](/playlists/p1)", likes: 4 },
  { author: "tricorder", ago: 52, body: "重看第 N 遍，依然在 Locutus 出场时暂停截图。", likes: 2 },
  { author: "warp_nine", ago: 18, body: "看的时候一直在想，如果是我，会不会接受那个舰长的位置。", likes: 1 },
  { author: "new_cadet", ago: 3, body: "刚看完，**下一集**在哪里？！", likes: 0, replies: [{ author: "picard_fan", body: "右上角箭头，或者等片尾倒计时 😄" }] },
  { author: "ferengi_ledger", ago: 0.4, body: "字幕组辛苦了，这集的中文字幕比我以前看的版本准确很多 🙏", likes: 0 },
]

const GENERIC_TOP = [
  "配乐真好听。",
  "这集节奏有点慢，但最后十分钟值回票价。",
  "**舰长的演技**撑起了整集。",
  "第一次看，有点没看懂中间那段时间线，有人能解释一下吗？",
  "> Make it so.\n\n每次听到都想站起来。🖖",
  "这集的特效放到今天也不过时。",
  "桥段很经典，后面好几部剧都在致敬它。",
  "全息甲板又双叒叕出故障了 🤣",
  "补完这季了，打卡 ✅",
  "这一集适合给新人入坑吗？",
  "中文字幕有一处可以商榷：`warp core` 译成“曲速核心”比“经线核心”更通用。",
  "看到这里突然理解了为什么那么多人说这部剧是“太空版的人生课”。",
  "二刷发现了好多第一次没注意的细节。",
  "这季的服装设计是全系列最好看的。",
  "有人整理过这集的所有彩蛋吗？",
  "刚开始看，不要剧透谢谢 🙏",
  "结尾那段独白，建议戴耳机听。",
  "看完去查了一下，原来这集的剧本改了好几稿：[Memory Alpha](https://memory-alpha.fandom.com/)",
  "Tea. Earl Grey. Hot. ☕",
  "认真说几点感受：\n\n- 主线推进得很稳，没有为了反转而反转\n- 配角的弧光比主角还完整\n- 唯一的问题是 B 故事线和主线几乎没有关系\n\n总体 8/10，推荐。",
  "这集要是放在今天，肯定会拆成两集播。",
  "每次重看都能被这群人之间的友情打动。",
  "建议开英文字幕看一遍，很多双关语中文没法完全翻出来。",
  "这一集的客串演员后来也演了别的角色，认出来了吗？",
  "*这才是星际迷航*。",
]

// Movies draw from the lines that do not talk about episodes or seasons, plus these.
const MOVIE_TOP = [
  "这部电影的特效放到今天也不过时。",
  "**反派的演技**撑起了整部电影。",
  "当年在影院看过一次，音效完全是另一个级别。",
  "电影版的配乐比剧集更有气势。",
  "节奏比剧集紧凑太多，最后半小时一气呵成。",
  "有人整理过这部电影的所有彩蛋吗？",
  "没看过剧集直接看这部，能看懂吗？",
]

const GENERIC_REPLY = [
  "同意！",
  "+1",
  "哈哈哈哈哈",
  "我也是这么想的。",
  "不同意，我觉得恰恰相反。",
  "**完全同意**，尤其是最后那段。",
  "> 说得太好了\n\n深有同感。",
  "谢谢分享 🙏",
  "楼上说得对。",
  "原来如此，学到了。",
  "我第一次看也没看懂，二刷才明白。",
  "建议配合 DS9 一起看。",
  "这个梗我笑了一天 🤣",
  "确实，节奏是慢了点。",
  "`Engage.` 🖖",
  "其实官方小说里有解释。",
  "顶上去。",
  "有道理。",
  "补充一下：导演后来在采访里也提过这件事。",
  "新人表示受教了。",
]

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function build(unitId: string, now: number): Comment[] {
  const rnd = mulberry32(hash(unitId))
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
  const seeds: Seed[] = []
  if (unitId === DEMO_UNIT) {
    seeds.push(...DEMO)
    // Pad the hand-written thread to 46 comments with generic chatter spread over the past year.
    const pool = [...GENERIC_TOP]
    while (seeds.length < 46) {
      const body = pool.splice(Math.floor(rnd() * pool.length), 1)[0] ?? pick(GENERIC_TOP)
      seeds.push({ author: pick(USERS), ago: Math.round(30 + rnd() ** 2 * 380 * 1440), body, likes: Math.floor(rnd() ** 3 * 20), dislikes: Math.floor(rnd() * 3), extra: rnd() < 0.3 ? 1 + Math.floor(rnd() * 3) : 0 })
    }
  } else if (unitId !== EMPTY_UNIT) {
    const lines = getUnit(unitId)?.kind === "movie" ? [...GENERIC_TOP.filter((b) => !/[集季]|这部剧/.test(b)), ...MOVIE_TOP] : GENERIC_TOP
    const n = 3 + Math.floor(rnd() * 20)
    const pool = [...lines]
    for (let i = 0; i < n; i++) {
      const body = pool.splice(Math.floor(rnd() * pool.length), 1)[0] ?? pick(lines)
      const extra = rnd() < 0.12 ? 6 + Math.floor(rnd() * 9) : rnd() < 0.4 ? 1 + Math.floor(rnd() * 3) : 0
      seeds.push({ author: pick(USERS), ago: Math.round(2 + rnd() ** 2 * 420 * 1440), body, likes: Math.floor(rnd() ** 3 * 40), dislikes: Math.floor(rnd() * 4), extra })
    }
  }

  seeds.sort((a, b) => b.ago - a.ago)
  const out: Comment[] = []
  seeds.forEach((s, i) => {
    const id = `${unitId}:${i + 1}`
    const createdAt = now - s.ago * MIN
    out.push({ id, unitId, seq: i + 1, parentId: null, replyTo: null, author: s.author, body: s.body, createdAt, likes: s.likes, dislikes: s.dislikes ?? 0 })
    const replies: ReplySeed[] = [...(s.replies ?? [])]
    for (let k = 0; k < (s.extra ?? 0); k++) replies.push({ author: pick(USERS), body: pick(GENERIC_REPLY), likes: Math.floor(rnd() ** 2 * 6) })
    // Replies land between the parent and now, in order, denser right after the parent.
    const span = now - createdAt
    let t = createdAt
    replies.forEach((r, k) => {
      const left = replies.length - k
      t += Math.max(MIN, ((now - t) / (left + 1)) * (0.2 + rnd() * 0.9) * Math.min(1, span / DAY + 0.05))
      out.push({ id: `${id}.${k + 1}`, unitId, seq: k + 1, parentId: id, replyTo: r.replyTo ?? null, author: r.author, body: r.body, createdAt: Math.min(t, now - 20_000), likes: r.likes ?? 0, dislikes: 0 })
    })
  })
  return out
}

// ---- store ----

type State = { threads: Record<string, Comment[]>; votes: Record<string, Vote> }

let state: State = { threads: {}, votes: {} }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

function ensure(unitId: string) {
  if (!state.threads[unitId]) state = { ...state, threads: { ...state.threads, [unitId]: build(unitId, Date.now()) } }
  return state.threads[unitId]
}

function useThreadState(unitId: string) {
  const s = useSyncExternalStore(subscribe, () => {
    ensure(unitId)
    return state
  })
  return { comments: s.threads[unitId] ?? [], votes: s.votes }
}

export const commentActions = {
  vote(id: string, v: Vote) {
    const votes = { ...state.votes }
    if (votes[id] === v) delete votes[id]
    else votes[id] = v
    state = { ...state, votes }
    emit()
  },
  post(input: { unitId: string; author: string; body: string; parentId?: string | null; replyTo?: string | null }) {
    const list = ensure(input.unitId)
    const parentId = input.parentId ?? null
    const seq = list.filter((c) => c.parentId === parentId).reduce((m, c) => Math.max(m, c.seq), 0) + 1
    const c: Comment = {
      id: parentId ? `${parentId}.${seq}` : `${input.unitId}:${seq}`,
      unitId: input.unitId,
      seq,
      parentId,
      replyTo: input.replyTo ?? null,
      author: input.author,
      body: input.body.trim(),
      createdAt: Date.now(),
      likes: 0,
      dislikes: 0,
      fresh: true,
    }
    state = { ...state, threads: { ...state.threads, [input.unitId]: [...list, c] } }
    emit()
    return c
  },
}

export function likesOf(c: Comment, votes: Record<string, Vote>) {
  return c.likes + (votes[c.id] === 1 ? 1 : 0)
}

// ---- ranking ----

/** Lower bound of the Wilson score interval (95%): how sure we are that people like it. */
function wilson(up: number, n: number) {
  if (n === 0) return 0.5
  const z = 1.96
  const p = up / n
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / (1 + (z * z) / n)
}

/**
 * Smart sort: approval quality (likes vs hidden dislikes) times engagement (likes, then replies at half
 * weight, on a log scale), plus a boost that fades over ~2 days so new comments get seen at all.
 */
function smartScore(c: Comment, replyCount: number, votes: Record<string, Vote>, now: number) {
  const up = likesOf(c, votes)
  const down = c.dislikes + (votes[c.id] === -1 ? 1 : 0)
  const ageH = (now - c.createdAt) / HOUR
  return wilson(up, up + down) * Math.log2(1 + up + 0.5 * replyCount) + 1.5 * Math.exp(-ageH / 48)
}

// ---- views ----

export type Feed = ReturnType<typeof useCommentFeed>

/** Top-level list with sort and pagination; replies grouped per thread, always in posting order. */
export function useCommentFeed(unitId: string, me: string, pageSize = PAGE_SIZE) {
  const { comments, votes } = useThreadState(unitId)
  const [sort, setSortState] = useState<SortKey>("smart")
  const [page, setPageState] = useState(1)

  const { tops, replies } = useMemo(() => {
    const replies = new Map<string, Comment[]>()
    const tops: Comment[] = []
    for (const c of comments) {
      if (!c.parentId) tops.push(c)
      else {
        const list = replies.get(c.parentId) ?? []
        list.push(c)
        replies.set(c.parentId, list)
      }
    }
    for (const list of replies.values()) list.sort((a, b) => a.createdAt - b.createdAt)
    return { tops, replies }
  }, [comments])

  // Scores read the vote map at sort time only, so a click on 赞 does not reshuffle the page under the cursor.
  const [sortedAt, setSortedAt] = useState(() => ({ votes, now: Date.now() }))
  const ordered = useMemo(() => {
    const { votes: v, now } = sortedAt
    const score = new Map(tops.map((c) => [c.id, smartScore(c, replies.get(c.id)?.length ?? 0, v, now)]))
    const pinned = (c: Comment) => !!c.fresh && c.author === me
    return [...tops].sort((a, b) => {
      if (pinned(a) !== pinned(b)) return pinned(a) ? -1 : 1
      if (pinned(a) || sort === "new") return b.createdAt - a.createdAt
      if (sort === "old") return a.createdAt - b.createdAt
      return score.get(b.id)! - score.get(a.id)!
    })
  }, [tops, replies, sort, sortedAt, me])

  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize))
  const current = Math.min(page, pageCount)
  return {
    unitId,
    sort,
    setSort(s: SortKey) {
      setSortState(s)
      setSortedAt({ votes, now: Date.now() })
      setPageState(1)
    },
    page: current,
    pageCount,
    setPage(p: number) {
      setPageState(Math.max(1, Math.min(pageCount, p)))
    },
    pageSize,
    items: ordered.slice((current - 1) * pageSize, current * pageSize),
    repliesOf: (id: string) => replies.get(id) ?? [],
    topCount: tops.length,
    votes,
  }
}

/** Re-renders every `ms` so relative timestamps keep moving. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function useMe() {
  return useStore((s) => s.me)
}

// ---- time ----

const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })
const LONG_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })
const FULL = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

/** Under a week: "just now", "5m ago", "3h ago", "2d ago". Older: "Sep 12", or "Aug 3, 2025" from another year. */
export function formatCommentTime(t: number, now: number) {
  const d = Math.max(0, now - t)
  if (d < MIN) return "just now"
  if (d < HOUR) return `${Math.floor(d / MIN)}m ago`
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`
  if (d < 7 * DAY) return `${Math.floor(d / DAY)}d ago`
  return new Date(t).getFullYear() === new Date(now).getFullYear() ? SHORT_DATE.format(t) : LONG_DATE.format(t)
}

export function formatFullTime(t: number) {
  return FULL.format(t)
}
