import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [index("routes/home.tsx"), route("about", "routes/about.tsx"), route("robots.txt", "routes/robots.ts"),
  ...["login", "register", "forgot-password", "reset-password", "reset-password/complete", "verify-email", "verify-pending"].map(path => route(path, "routes/auth.tsx", { id: path })),
  route("account", "routes/account.tsx"), route("invites", "routes/invites.tsx"), route("admin", "routes/admin.tsx"),
] satisfies RouteConfig;
