import { data, isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { Route } from "./+types/root";
import { SiteShell } from "@/components/site/site-shell";
import { NotFoundPage } from "@/components/site/not-found";
import { themeInitScript } from "@/lib/theme";
import { currentMember } from "@/lib/member.server";
import "@fontsource-variable/antonio";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/noto-sans-sc";
import "@/styles/globals.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const current = await currentMember(request, context.cloudflare.env);
  return data({ role: current?.member.role ?? null }, { headers: current?.headers });
}

export default function App({ loaderData }: Route.ComponentProps) {
  const items = loaderData.role ? [{ to: "/account", label: "账号" }, { to: "/invites", label: "邀请" },
    ...(loaderData.role === "admin" ? [{ to: "/admin", label: "管理" }] : []), { to: "/about", label: "关于" }] : undefined;
  return <SiteShell memberNavigation={items}><Outlet /></SiteShell>;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const forbidden = isRouteErrorResponse(error) && error.status === 403;
  return (
    <SiteShell>{notFound ? <NotFoundPage /> : <div data-width="narrow" className="mx-auto min-h-[70svh] border-x p-4 md:max-w-(--content-width)"><h1>{forbidden ? "访问受限" : "出错了"}</h1><p>{forbidden ? "你没有访问此页面的权限。" : "页面暂时无法显示，请稍后再试。"}</p></div>}</SiteShell>
  );
}
