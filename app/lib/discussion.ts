// The discussion API contract: built by discussion.server.ts, read by the watch-page section.
export type Vote = 1 | -1 | 0;
export type SortKey = "smart" | "new" | "old";
export type Reply = { id: string; author: string; admin: boolean; mine: boolean; replyTo: string | null; body: string; createdAt: number; likes: number; vote: Vote };
export type Comment = Omit<Reply, "replyTo"> & { replyCount: number; replies: Reply[] };
