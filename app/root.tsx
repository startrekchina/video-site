import { data, isRouteErrorResponse, Link, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteLoaderData, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/root";
import { SiteShell } from "@/components/site/site-shell";
import { NotFoundPage } from "@/components/site/not-found";
import { themeInitScript } from "@/lib/theme";
import { catalogSummary } from "@/lib/catalog.server";
import { presentationNavigation } from "@/lib/catalog";
import { pageTitle } from "@/lib/site";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Page } from "@/components/site/panel";
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

declare const __BUILD_COMMIT__: string;
// The commit travels only in loader data, so client chunks keep their hashes across deployments.
export async function loader({ context }: Route.LoaderArgs) {
  const current = await context.identity.read(catalogSummary);
  return data({ member: current ? { username: current.member.displayUsername || current.member.username, role: current.member.role } : null,
    catalog: current?.value ?? null, commit: __BUILD_COMMIT__, ray: context.ray ?? null, colo: context.colo ?? null }, { headers: current?.headers });
}
export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return !args.formMethod && presentationNavigation(args.currentUrl, args.nextUrl) ? false : args.defaultShouldRevalidate;
}
export function headers({ errorHeaders }: Route.HeadersArgs) { return errorHeaders ?? {}; }
// Routes without their own meta (home, error pages) inherit the bare site name.
export const meta = () => pageTitle();

export default function App({ loaderData }: Route.ComponentProps) {
  return <SiteShell member={loaderData.member} catalog={loaderData.catalog}><Outlet /></SiteShell>;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const forbidden = isRouteErrorResponse(error) && error.status === 403;
  const root = useRouteLoaderData<typeof loader>("root");
  return (
    <SiteShell member={root?.member} catalog={root?.catalog}>{notFound ? <NotFoundPage /> : <Page narrow><Empty className="min-h-[70svh]"><EmptyHeader><EmptyTitle><h1 className="text-2xl">{forbidden ? "访问受限" : "出错了"}</h1></EmptyTitle><EmptyDescription>{forbidden ? "你没有访问此页面的权限。" : "页面暂时无法显示，请稍后再试。"}</EmptyDescription></EmptyHeader><Button variant="outline" nativeButton={false} render={<Link to="/" />}>返回首页</Button>{!forbidden && <Button variant="ghost" onClick={() => location.reload()}>重试</Button>}</Empty></Page>}</SiteShell>
  );
}
