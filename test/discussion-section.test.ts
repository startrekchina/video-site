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
