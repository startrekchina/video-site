import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [index("routes/home.tsx"), route("about", "routes/about.tsx"), route("robots.txt", "routes/robots.ts"),
  ...["login", "register", "forgot-password", "reset-password", "reset-password/complete", "verify-email", "verify-pending"].map(path => route(path, "routes/auth.tsx", { id: path })),
  route("account", "routes/account.tsx"), route("invites", "routes/invites.tsx"), route("admin", "routes/admin.tsx"),
  route("admin/backups", "routes/backups.tsx"),
  route("series", "routes/catalog.tsx", { id: "series" }), route("movies", "routes/catalog.tsx", { id: "movies" }),
  route("search", "routes/catalog.tsx", { id: "search" }),
  // B 6.11: /series/tng[/s3], /series/tng/s3/e15, /movies/beyond[/watch]; the loaders parse s<n> and e<m>.
  route("series/:code/:season?", "routes/title.tsx", { id: "series-title" }), route("movies/:slug", "routes/title.tsx", { id: "movie-title" }),
  route("series/:code/:season/:episode", "routes/watch.tsx", { id: "series-watch" }), route("movies/:slug/watch", "routes/watch.tsx", { id: "movie-watch" }),
  route("library", "routes/library.tsx"), route("playlists", "routes/playlists.tsx"), route("playlists/:id", "routes/playlist.tsx"),
  route("*", "routes/not-found.tsx", { id: "not-found" }),
] satisfies RouteConfig;
