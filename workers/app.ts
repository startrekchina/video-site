import { createRequestIdentity, type RequestIdentity } from "../app/lib/member.server";
import { createRequestHandler } from "react-router";
import { APIError } from "better-auth/api";
import { authHttp } from "../app/lib/auth-http.server";
import { accountHttp } from "../app/lib/account.server";
import { invitationsHttp } from "../app/lib/invitations.server";
import { adminHttp } from "../app/lib/admin.server";
import { playbackHttp } from "../app/lib/playback.server";
import { progressHttp } from "../app/lib/progress.server";
import { libraryHttp } from "../app/lib/library.server";
import { discussionHttp } from "../app/lib/discussion.server";
import { danmakuHttp } from "../app/lib/danmaku.server";
import { backupsHttp, runScheduledBackup } from "../app/lib/backups.server";
import { mediaSyncCron, syncMedia } from "../app/lib/media-sync.server";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: { env: Env; ctx: ExecutionContext };
    identity: RequestIdentity;
    ray?: string;
    colo?: string;
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

const SECURITY_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export default {
  async scheduled(controller, env, ctx) {
    if (controller.cron === mediaSyncCron) {
      // D1 export can suspend queries. Do not start media scanning in the same backup tick.
      const backup = await runScheduledBackup(env, ctx);
      if (backup.status === "schedule_failed") {
        if (!backup.busy) await syncMedia(env);
        throw backup.error;
      }
      if (backup.status === "not_due" || backup.status === "unavailable") await syncMedia(env);
    }
  },
  async fetch(request: Request, env, ctx) {
    const path = new URL(request.url).pathname;
    const auth = path.startsWith("/api/auth/") || path === "/auth/register" || path === "/account/email-confirm";
    const account = path.startsWith("/account/sessions");
    const invites = path.startsWith("/invites/");
    const admin = path.startsWith("/admin/members/");
    const playback = path.startsWith("/media/") || path.startsWith("/subtitles/");
    const progress = path.startsWith("/me/progress/");
    const library = path.startsWith("/me/favorites/") || path === "/me/playlists" || path.startsWith("/me/playlists/");
    const danmaku = /^\/units\/[^/]+\/danmaku(?:\/|$)/u.test(path);
    const discussion = path.startsWith("/units/") && !danmaku;
    const backup = path.startsWith("/admin/backups/") || path === "/admin/backups" && request.method !== "GET";
    const requestId = crypto.randomUUID();
    const identity = createRequestIdentity(request, env);
    let input: Request = request;
    if (account || invites || admin || progress || library || discussion || danmaku || backup) {
      const inputHeaders = new Headers(request.headers); inputHeaders.set("X-Site-Request-Id", requestId);
      input = new Request(request, { headers: inputHeaders });
    }
    let response: Response;
    let code: string | undefined;
    try {
      response = auth ? await authHttp(input, env, identity) : account ? await accountHttp(input, env, identity)
        : invites ? await invitationsHttp(input, env, identity) : admin ? await adminHttp(input, env, identity) : playback ? await playbackHttp(input, env, identity)
        : progress ? await progressHttp(input, env, identity) : library ? await libraryHttp(input, env, identity) : discussion ? await discussionHttp(input, env, identity)
        : danmaku ? await danmakuHttp(input, env, identity)
        : backup ? await backupsHttp(input, env, ctx, identity)
        : await requestHandler(request, { cloudflare: { env, ctx }, identity, ray: request.headers.get("cf-ray")?.split("-")[0] || undefined, colo: request.cf?.colo as string | undefined });
    } catch (error) {
      const native = error instanceof APIError;
      code = native ? error.body?.code ?? "REQUEST_REJECTED" : "INTERNAL_ERROR";
      const message = native ? error.body?.message ?? "请求未完成。" : "请求未完成，请稍后重试。";
      response = Response.json(auth ? { code, message } : { error: { code, message }, requestId },
        { status: native ? error.statusCode : 500, headers: native ? error.headers : undefined });
    }
    const headers = identity.headers(response.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Request-Id", requestId);
    // Route families only: never log paths, queries, cookies or library errors; colo is the serving data center code.
    // Cloudflare attaches the original request path to each application log, even with invocation logs disabled.
    if (!path.startsWith("/api/auth/reset-password/")) console.info(JSON.stringify({ requestId, route: auth ? "auth" : account ? "account/sessions" : invites ? "invites" : admin ? "admin/members" : playback ? "playback" : progress ? "me/progress" : library ? "me/library" : discussion ? "units/discussion" : danmaku ? "units/danmaku" : backup ? "admin/backups" : "page", status: response.status, code, colo: request.cf?.colo }));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers, ...(playback ? { encodeBody: "manual" as const } : {}) });
  },
} satisfies ExportedHandler<Env>;
