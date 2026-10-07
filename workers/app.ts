import { createRequestHandler } from "react-router";
import { APIError } from "better-auth/api";
import { authHttp } from "../app/lib/auth-http.server";
import { accountHttp } from "../app/lib/account.server";
import { invitationsHttp } from "../app/lib/invitations.server";
import { adminHttp } from "../app/lib/admin.server";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: { env: Env; ctx: ExecutionContext };
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
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    const auth = path.startsWith("/api/auth/") || path === "/auth/register" || path === "/account/email-confirm";
    const account = path.startsWith("/account/sessions");
    const invites = path.startsWith("/invites/");
    const admin = path.startsWith("/admin/members/");
    const requestId = crypto.randomUUID();
    let input: Request = request;
    if (account || invites || admin) {
      const inputHeaders = new Headers(request.headers); inputHeaders.set("X-Site-Request-Id", requestId);
      input = new Request(request, { headers: inputHeaders });
    }
    let response: Response;
    let code: string | undefined;
    try {
      response = auth ? await authHttp(input, env) : account ? await accountHttp(input, env)
        : invites ? await invitationsHttp(input, env) : admin ? await adminHttp(input, env)
        : await requestHandler(request, { cloudflare: { env, ctx } });
    } catch (error) {
      const native = error instanceof APIError;
      code = native ? error.body?.code ?? "REQUEST_REJECTED" : "INTERNAL_ERROR";
      const message = native ? error.body?.message ?? "请求未完成。" : "请求未完成，请稍后重试。";
      response = Response.json(auth ? { code, message } : { error: { code, message }, requestId },
        { status: native ? error.statusCode : 500, headers: native ? error.headers : undefined });
    }
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Request-Id", requestId);
    // Route families only: never log paths, queries, cookies or library errors.
    // Cloudflare attaches the original request path to each application log, even with invocation logs disabled.
    if (!path.startsWith("/api/auth/reset-password/")) console.info(JSON.stringify({ requestId, route: auth ? "auth" : account ? "account/sessions" : invites ? "invites" : admin ? "admin/members" : "page", status: response.status, code }));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
} satisfies ExportedHandler<Env>;
