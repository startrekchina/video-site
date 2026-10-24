import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import DiscussionSection from "@/components/site/discussion/section";
import type { Comment } from "@/lib/discussion";

const state = vi.hoisted(() => ({
  values: [] as unknown[], refs: [] as { current: unknown }[], deps: [] as (readonly unknown[])[],
  effects: [] as (() => void | (() => void))[], cleanups: [] as (() => void)[],
  valueIndex: 0, refIndex: 0, effectIndex: 0, wide: true, request: vi.fn(),
}));
// Exercise the real section and event handlers with the same hook boundary used by player tests.
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = state.valueIndex++;
    if (!(index in state.values)) state.values[index] = typeof initial === "function" ? initial() : initial;
    return [state.values[index], (next: unknown) => { state.values[index] = typeof next === "function" ? next(state.values[index]) : next; }];
  },
  useRef: (current: unknown) => state.refs[state.refIndex++] ??= { current },
  useSyncExternalStore: () => state.wide,
  useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
    const index = state.effectIndex++;
    if (!state.deps[index] || deps.some((value, i) => value !== state.deps[index][i])) state.effects.push(effect);
    state.deps[index] = deps;
  },
}));
vi.mock("react-dom", () => ({ flushSync: (run: () => void) => run() }));
vi.mock("react-router", async original => ({ ...await original<typeof import("react-router")>(), useRouteLoaderData: () => ({ member: { username: "Kepler", role: "admin" } }) }));
vi.mock("@/lib/library-client", () => ({ libraryRequest: state.request }));
vi.mock("@/components/ui/toast", () => ({ toast: { add: vi.fn() } }));

const comments: Comment[] = Array.from({ length: 20 }, (_, index) => ({
  id: `c${index}`, author: "Nova", admin: false, mine: false, body: `Fictional comment ${index}`,
  createdAt: index, likes: 0, vote: 0, replyCount: 1, replies: [],
}));
const posted: Comment = { ...comments[0], id: "posted", mine: true, body: "Fictional new comment" };
beforeEach(() => {
  state.values = []; state.refs = []; state.deps = []; state.effects = []; state.cleanups = []; state.wide = true;
  state.request.mockReset().mockImplementation(async (path: string, method: string) => {
    if (method === "POST") return { data: posted };
    if (method === "DELETE") return { data: { deleted: true } };
    const ids = new URL(path, "http://localhost").searchParams.get("ids")?.split(",");
    return { data: ids ? { items: comments.filter(c => ids.includes(c.id)) }
      : { order: comments.map(c => c.id), items: comments.slice(0, 10), pageSize: 10, maxLength: 1000 } };
  });
});
afterEach(() => { state.cleanups.forEach(cleanup => cleanup()); });

function render() {
  state.valueIndex = 0; state.refIndex = 0; state.effectIndex = 0;
  const tree = DiscussionSection({ unitId: "episode-unit", kind: "episode" });
  for (const effect of state.effects.splice(0)) {
    const cleanup = effect();
    if (cleanup) state.cleanups.push(cleanup);
  }
  return tree;
}
function elements<P extends object>(node: ReactNode, name: string): ReactElement<P>[] {
  if (Array.isArray(node)) return node.flatMap(child => elements<P>(child, name));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [...(typeof node.type === "function" && node.type.name === name ? [node as ReactElement<P>] : []), ...elements<P>(node.props.children, name)];
}
type Row = { c: Comment; open: boolean; onOpen: () => void };
const rows = (tree: ReactNode) => elements<Row>(tree, "CommentRow");
const pager = (tree: ReactNode) => elements<{ page: number; onChange: (page: number) => void }>(tree, "NumberPager")[0].props;
const composer = (tree: ReactNode) => elements<{ onSubmit: (body: string) => Promise<boolean> }>(tree, "Composer")[0].props;
const conversation = (tree: ReactNode) => elements<{ thread: { root: Comment } }>(tree, state.wide ? "ConversationPane" : "InlineThread")[0]?.props.thread.root.id;
async function mount(page = 1) {
  render(); await Promise.resolve();
  let tree = render();
  if (page !== 1) { pager(tree).onChange(page); tree = render(); await Promise.resolve(); tree = render(); }
  return tree;
}

it.each([[true, 1], [false, 1], [true, 2], [false, 2]] as const)("keeps the selected conversation after posting (wide=%s, page=%s)", async (wide, page) => {
  state.wide = wide;
  let tree = await mount(page);
  const selected = rows(tree).at(-1)!;
  selected.props.onOpen(); tree = render();
  expect(conversation(tree)).toBe(selected.props.c.id);
  await composer(tree).onSubmit(posted.body); tree = render();
  expect(rows(tree)[0].props.c.id).toBe(posted.id);
  expect(pager(tree).page).toBe(1);
  expect(conversation(tree)).toBe(selected.props.c.id);
  expect(rows(tree).filter(row => row.props.c.id === selected.props.c.id)).toHaveLength(wide ? 0 : 1);
  pager(tree).onChange(2); tree = render(); await Promise.resolve(); tree = render();
  expect(conversation(tree)).toBe(wide ? "c9" : undefined);
});

it("keeps the default conversation from a later desktop page", async () => {
  let tree = await mount(2);
  expect(conversation(tree)).toBe("c10");
  await composer(tree).onSubmit(posted.body); tree = render();
  expect(conversation(tree)).toBe("c10");
});

it("keeps the conversation selected while a post is pending", async () => {
  let finish!: (value: { data: Comment }) => void;
  state.request.mockImplementationOnce(async () => ({ data: { order: comments.map(c => c.id), items: comments.slice(0, 10), pageSize: 10, maxLength: 1000 } }));
  let tree = await mount();
  state.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const sending = composer(tree).onSubmit(posted.body);
  rows(tree).at(-1)!.props.onOpen(); tree = render();
  finish({ data: posted }); await sending; tree = render();
  expect(conversation(tree)).toBe("c9");
});

function commentList(node: ReactNode): ReactElement<{ "aria-busy": boolean }> | undefined {
  if (Array.isArray(node)) return node.map(commentList).find(Boolean);
  if (!isValidElement<{ children?: ReactNode; "aria-busy": boolean }>(node)) return;
  return node.type === "ol" ? node : commentList(node.props.children);
}
const retryPage = (tree: ReactNode) => elements<{ children: ReactNode; onClick: () => void }>(tree, "Button").find(button => button.props.children === "重试");
const thread = (tree: ReactNode) => elements<{ thread: { root: Comment; loadingMore: boolean; onMore: () => void; composer: ReactElement<{ value: string; sending?: boolean; onValueChange: (value: string) => void; onSubmit: (body: string) => Promise<boolean> }> } }>(tree, state.wide ? "ConversationPane" : "InlineThread")[0]?.props.thread;

it.each([true, false])("offers a retry after a page read fails (wide=%s)", async wide => {
  state.wide = wide;
  let tree = await mount();
  state.request.mockResolvedValueOnce({ error: { status: 0 } });
  pager(tree).onChange(2); render(); await Promise.resolve(); tree = render();
  expect(rows(tree)).toHaveLength(0);
  expect(commentList(tree)?.props["aria-busy"]).toBe(false);
  expect(retryPage(tree)).toBeDefined();
  expect(pager(tree).page).toBe(2);

  state.request.mockResolvedValueOnce({ error: { status: 503, message: "暂时不可用。" } });
  retryPage(tree)!.props.onClick(); tree = render();
  expect(commentList(tree)?.props["aria-busy"]).toBe(true);
  await Promise.resolve(); tree = render();
  expect(commentList(tree)?.props["aria-busy"]).toBe(false);
  expect(retryPage(tree)).toBeDefined();

  retryPage(tree)!.props.onClick(); render(); await Promise.resolve(); tree = render();
  expect(rows(tree).map(row => row.props.c.id)).toEqual(comments.slice(10).map(c => c.id));
  expect(commentList(tree)?.props["aria-busy"]).toBe(false);
  expect(retryPage(tree)).toBeUndefined();
  expect(pager(tree).page).toBe(2);
});

it.each([[true, false], [false, false], [true, true], [false, true]] as const)("loads a posted reply across a sort refresh (wide=%s, lateSort=%s)", async (wide, lateSort) => {
  state.wide = wide;
  let tree = await mount(2);
  const root = { ...comments[10], replyCount: 0, replies: [] };
  const replies = Array.from({ length: 11 }, (_, index) => ({
    ...root, id: `r${index}`, body: `Fictional reply ${index}`, createdAt: 100 + index, replyTo: null,
  }));
  const answer = replies.at(-1)!;
  let finishPost!: (value: { data: typeof answer }) => void;
  let finishSort!: (value: { data: { order: string[]; items: Comment[]; pageSize: number; maxLength: number } }) => void;
  state.request.mockImplementation((path: string, method: string) => {
    if (method === "POST") return new Promise(resolve => { finishPost = resolve; });
    if (path.includes("sort=")) return new Promise(resolve => { finishSort = resolve; });
    if (path.includes("/replies?")) return Promise.resolve({ data: path.includes("afterId=r9") ? { items: replies.slice(10), rest: 0 } : { items: replies.slice(0, 10), rest: 1 } });
    const ids = new URL(path, "http://localhost").searchParams.get("ids")!.split(",");
    return Promise.resolve({ data: { items: comments.filter(c => ids.includes(c.id)).map(c => c.id === root.id ? { ...root, replyCount: 11, replies: replies.slice(0, 10) } : c) } });
  });
  rows(tree)[0].props.onOpen(); tree = render();
  thread(tree)!.composer.props.onValueChange(answer.body); tree = render();
  const posting = thread(tree)!.composer.props.onSubmit(answer.body); render();
  elements<{ onChange: (sort: string) => void }>(tree, "SortTabs")[0].props.onChange("new"); render();
  const sorted = { data: { order: comments.map(c => c.id), items: comments.slice(0, 10), pageSize: 10, maxLength: 1000 } };
  if (!lateSort) { finishSort(sorted); await Promise.resolve(); render(); }
  finishPost({ data: answer }); expect(await posting).toBe(true); render();
  if (lateSort) { finishSort(sorted); await Promise.resolve(); render(); }

  tree = render(); pager(tree).onChange(2); render();
  await vi.waitUntil(() => {
    tree = render();
    return state.request.mock.calls.filter(([path]) => path.includes("/replies?")).length === 3 && rows(tree)[0]?.props.c.replies.length === 11;
  });
  rows(tree)[0].props.onOpen(); tree = render();
  expect(thread(tree)!.root.replies.map(r => r.id)).toEqual(replies.map(r => r.id));
  expect(thread(tree)!.root.replyCount).toBe(11);
  expect(thread(tree)!.composer.props.value).toBe("");
  expect(state.request.mock.calls.filter(([path]) => path.includes("/replies?"))).toHaveLength(3);
});

it.each([true, false])("refreshes a retained conversation when its page is revisited (wide=%s)", async wide => {
  state.wide = wide;
  let likes = 0, finishPost!: (value: { data: object }) => void;
  const answer = { ...comments[10], id: "new-reply", createdAt: 100, replyTo: null };
  state.request.mockImplementation((path: string, method: string) => {
    if (method === "POST") return new Promise(resolve => { finishPost = resolve; });
    if (path.includes("/replies?")) return Promise.resolve({ data: { items: [answer], rest: 0 } });
    const ids = new URL(path, "http://localhost").searchParams.get("ids")?.split(",");
    return Promise.resolve({ data: ids ? { items: comments.filter(c => ids.includes(c.id)).map(c => ({ ...c, likes })) }
      : { order: comments.map(c => c.id), items: comments.slice(0, 10), pageSize: 10, maxLength: 1000 } });
  });
  let tree = await mount(2);
  rows(tree)[0].props.onOpen(); tree = render();
  const pending = thread(tree)!.composer.props.onSubmit(answer.body); render();
  try {
    likes = 5;
    elements<{ onChange: (sort: string) => void }>(tree, "SortTabs")[0].props.onChange("new"); render();
    await Promise.resolve(); render(); finishPost({ data: answer }); await pending; tree = render();
    pager(tree).onChange(2); render();
    await vi.waitUntil(() => { tree = render(); return rows(tree)[0]?.props.c.likes === 5 && rows(tree)[0]?.props.c.replies.some(reply => reply.id === answer.id); });
    const root = rows(tree).find(row => row.props.c.id === comments[10].id)!.props.c;
    expect.soft(root.likes).toBe(5);
    expect(root.replies.map(reply => reply.id)).toContain(answer.id);
  } finally { finishPost({ data: answer }); await pending; }
});

it.each([true, false])("holds the reply send lock through reloads and conversation remounts (wide=%s)", async wide => {
  state.wide = wide;
  let resume!: () => void;
  const blocked = new Promise<void>(resolve => { resume = resolve; });
  const answer = { ...comments[10], id: "new-reply", createdAt: 100, replyTo: null };
  state.request.mockImplementation(async (path: string, method: string) => {
    if (method === "POST") return { data: answer };
    if (path.includes("/replies?")) { await blocked; return { data: { items: [answer], rest: 0 } }; }
    const ids = new URL(path, "http://localhost").searchParams.get("ids")?.split(",");
    return { data: ids ? { items: comments.filter(c => ids.includes(c.id)) }
      : { order: comments.map(c => c.id), items: comments.slice(0, 10), pageSize: 10, maxLength: 1000 } };
  });
  let tree = await mount(2);
  rows(tree)[0].props.onOpen(); tree = render();
  const pending = thread(tree)!.composer.props.onSubmit(answer.body);
  let duplicate: Promise<boolean> | undefined;
  try {
    await vi.waitUntil(() => state.request.mock.calls.some(([path]) => path.includes("/replies?")));
    tree = render(); rows(tree)[1].props.onOpen(); tree = render(); rows(tree)[0].props.onOpen(); tree = render();
    expect.soft(thread(tree)!.composer.props.sending).toBe(true);
    duplicate = thread(tree)!.composer.props.onSubmit("Another fictional reply");
    await Promise.resolve(); await Promise.resolve();
    expect.soft(state.request.mock.calls.filter(([, method]) => method === "POST")).toHaveLength(1);
    resume(); expect(await pending).toBe(true); expect(await duplicate).toBe(false);
    tree = render(); expect(thread(tree)!.composer.props.sending).toBe(false);
  } finally { resume(); await pending; await duplicate; }
});

it.each([
  [true, 4, false, 0], [false, 4, false, 0], [true, 10, false, 0], [false, 10, false, 0],
  [true, 10, true, 0], [false, 10, true, 0], [true, 10, false, 20], [false, 10, false, 20],
] as const)("revalidates retained reply contents (wide=%s, deleted=%s, retry=%s, extra=%s)", async (wide, deleted, retry, extra) => {
  state.wide = wide;
  const root = { ...comments[10], replyCount: 0, replies: [] };
  const original = Array.from({ length: 11 }, (_, index) => ({
    ...root, id: `r${index}`, body: `Fictional reply ${index}`, createdAt: 100 + index, replyTo: null,
  }));
  const answer = original.at(-1)!;
  let replies = original, failNext = false, finishPost!: (value: { data: typeof answer }) => void;
  state.request.mockImplementation((path: string, method: string) => {
    if (method === "POST") return new Promise(resolve => { finishPost = resolve; });
    const url = new URL(path, "http://localhost");
    if (path.includes("/replies?")) {
      if (failNext) { failNext = false; return Promise.resolve({ error: { status: 503 } }); }
      const after = Number(url.searchParams.get("afterAt"));
      const remaining = replies.filter(reply => reply.createdAt > after);
      return Promise.resolve({ data: { items: remaining.slice(0, 10), rest: Math.max(0, remaining.length - 10) } });
    }
    const ids = url.searchParams.get("ids")?.split(",");
    return Promise.resolve({ data: ids ? { items: comments.filter(c => ids.includes(c.id)).map(c => c.id === root.id ? { ...root, replyCount: replies.length, replies: replies.slice(0, 10) } : c) }
      : { order: comments.map(c => c.id), items: comments.slice(0, 10), pageSize: 10, maxLength: 1000 } });
  });
  let tree = await mount(2);
  rows(tree)[0].props.onOpen(); tree = render();
  const posting = thread(tree)!.composer.props.onSubmit(answer.body); render();
  try {
    elements<{ onChange: (sort: string) => void }>(tree, "SortTabs")[0].props.onChange("new"); render();
    await Promise.resolve(); render(); finishPost({ data: answer }); await posting; render();
    replies = [...original.filter(reply => reply.id !== `r${deleted}`).map(reply => ({ ...reply, likes: 5 })), { ...answer, id: "r11", createdAt: 111, body: "Fictional replacement reply" }];
    replies.push(...Array.from({ length: extra }, (_, index) => ({ ...answer, id: `r${12 + index}`, createdAt: 112 + index })));
    failNext = retry;
    pager(render()).onChange(2); tree = render();
    rows(tree)[0].props.onOpen(); tree = render();
    if (retry) {
      await vi.waitUntil(() => { tree = render(); return thread(tree)!.root.replies[0]?.likes === 5 && !thread(tree)!.loadingMore; });
      expect(thread(tree)!.root.replies.map(reply => reply.id)).toEqual(replies.slice(0, 10).map(reply => reply.id));
      expect(thread(tree)!.root.replyCount).toBe(11);
      thread(tree)!.onMore();
    }
    await vi.waitUntil(() => {
      tree = render();
      return !thread(tree)!.loadingMore && thread(tree)!.root.replies.some(reply => reply.id === "r11");
    });
    const refreshed = thread(tree)!.root;
    expect.soft(refreshed.replies.map(reply => reply.id)).toEqual(replies.slice(0, 20).map(reply => reply.id));
    expect.soft(refreshed.replies.some(reply => reply.id === `r${deleted}`)).toBe(false);
    expect.soft(refreshed.replies[0].likes).toBe(5);
    expect(refreshed.replyCount).toBe(replies.length);
    expect(state.request.mock.calls.filter(([path]) => path.includes("/replies?"))).toHaveLength(retry ? 3 : 2);
  } finally { finishPost({ data: answer }); await posting; }
});

it.each(([
  ["post", "success"], ["post", "failure"], ["post", "page-failure"],
  ["load", "success"], ["load", "failure"], ["sort", "success"],
] as const).flatMap(([phase, outcome]) => [true, false].map(wide => [wide, phase, outcome] as const)))("revalidates after a protected conversation becomes idle (wide=%s, phase=%s, outcome=%s)", async (wide, phase, outcome) => {
  state.wide = wide;
  const root = { ...comments[10], replyCount: 0, replies: [] };
  let replies = Array.from({ length: phase === "post" ? 11 : 21 }, (_, index) => ({
    ...root, id: `r${index}`, body: `Fictional reply ${index}`, createdAt: 100 + index, replyTo: null,
  }));
  const answer = { ...replies[0], id: "posted-reply", body: "Fictional posted reply", createdAt: 200 };
  let resume!: () => void;
  const blocked = new Promise<void>(resolve => { resume = resolve; });
  let holdLoad = false, released = false, failPage = outcome === "page-failure";
  state.request.mockImplementation(async (path: string, method: string) => {
    if (method === "POST") {
      await blocked;
      if (outcome === "failure") return { error: { status: 503 } };
      replies = [...replies, answer];
      return { data: answer };
    }
    const url = new URL(path, "http://localhost");
    if (path.includes("/replies?")) {
      if (holdLoad) {
        holdLoad = false;
        await blocked;
        if (outcome === "failure") return { error: { status: 503 } };
      }
      const after = Number(url.searchParams.get("afterAt"));
      const remaining = replies.filter(reply => reply.createdAt > after);
      return { data: { items: remaining.slice(0, 10), rest: Math.max(0, remaining.length - 10) } };
    }
    const ids = url.searchParams.get("ids")?.split(",");
    if (ids?.includes(root.id) && released && failPage) {
      failPage = false;
      return { error: { status: 503 } };
    }
    const order = phase === "sort" && url.searchParams.get("sort") === "new"
      ? [root.id, ...comments.filter(c => c.id !== root.id).map(c => c.id)] : comments.map(c => c.id);
    const items = (ids ?? order.slice(0, 10)).map(id => comments.find(c => c.id === id)!).map(c => c.id === root.id ? { ...root, replies: replies.slice(0, 10), replyCount: replies.length } : c);
    return { data: ids ? { items } : { order, items, pageSize: 10, maxLength: 1000 } };
  });
  let tree = await mount(2);
  rows(tree)[0].props.onOpen(); tree = render();
  thread(tree)!.onMore();
  const initialDepth = phase === "post" ? 11 : 20;
  await vi.waitUntil(() => { tree = render(); return thread(tree)!.root.replies.length === initialDepth && !thread(tree)!.loadingMore; });
  let posting: Promise<boolean> | undefined;
  if (phase === "post") {
    thread(tree)!.composer.props.onValueChange(answer.body); tree = render();
    posting = thread(tree)!.composer.props.onSubmit(answer.body); render();
  } else {
    holdLoad = true;
    thread(tree)!.onMore(); render();
  }
  try {
    replies = replies.filter(reply => reply.id !== "r4").map(reply => ({ ...reply, likes: 5 }));
    elements<{ onChange: (sort: string) => void }>(render(), "SortTabs")[0].props.onChange("new"); render();
    await Promise.resolve(); tree = render();
    if (phase !== "sort") { pager(tree).onChange(2); render(); await Promise.resolve(); tree = render(); }
    rows(tree).find(row => row.props.c.id === root.id)!.props.onOpen(); tree = render();
    expect(thread(tree)!.root.replies.some(reply => reply.id === "r4")).toBe(true);
    if (phase === "post") expect(thread(tree)!.composer.props.sending).toBe(true);
    else expect(thread(tree)!.loadingMore).toBe(true);
    released = true; resume();
    if (posting) expect(await posting).toBe(outcome !== "failure");
    if (outcome === "page-failure") {
      await vi.waitUntil(() => { tree = render(); return !!retryPage(tree); });
      expect(commentList(tree)?.props["aria-busy"]).toBe(false);
      retryPage(tree)!.props.onClick(); render();
    }
    await vi.waitUntil(() => { tree = render(); return thread(tree)!.root.replies[0]?.likes === 5 && !thread(tree)!.loadingMore; });
    const refreshed = thread(tree)!;
    expect(refreshed.root.replies).toEqual(replies);
    expect(refreshed.root.replyCount).toBe(replies.length);
    expect(refreshed.composer.props.sending).toBe(false);
    expect(refreshed.composer.props.value).toBe(phase === "post" && outcome === "failure" ? answer.body : "");
    expect(commentList(tree)?.props["aria-busy"]).toBe(false);
  } finally { resume(); await posting; }
});
