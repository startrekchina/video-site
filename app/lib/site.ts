export const siteName = "星际舰队档案馆";

/** Route meta for a page title: the page's own parts first, the site name last. */
export const pageTitle = (...parts: (string | null | undefined)[]) => [{ title: [...parts.filter(Boolean), siteName].join(" · ") }];
