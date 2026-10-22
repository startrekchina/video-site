import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { CommentBody } from "@/components/site/discussion/parts";

// Comments are stored as typed; this renderer is what keeps member Markdown from becoming page markup.
it("renders the comment Markdown subset and nothing that can run or embed", () => {
  vi.stubGlobal("window", { location: { origin: "https://archive.test", href: "https://archive.test/watch/u1" } });
  const body = [
    "[危险](javascript:alert(1)) <script>alert(1)</script> <b onclick=\"x()\">粗</b> ![图](https://example.com/x.png)",
    "[站外](https://example.com/page) [协议相对](//example.com/x) [站内](/series?s=1#a) [本站全址](https://archive.test/movies)",
    "",
    "| a | b |\n|---|---|\n| 1 | 2 |",
    "",
    "# 标题",
    "",
    "第一行\n第二行 `code` ~~删~~",
  ].join("\n");
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CommentBody, { body })));
  vi.unstubAllGlobals();

  expect(html).not.toMatch(/javascript:|<script|onclick|<img|<table|<h1|<b>/u);
  expect(html).toContain("危险");
  expect(html).toContain('<a href="https://example.com/page" target="_blank" rel="nofollow ugc noopener noreferrer">站外</a>');
  expect(html).toContain('<a href="//example.com/x" target="_blank" rel="nofollow ugc noopener noreferrer">协议相对</a>');
  expect(html).toContain('<a href="/series?s=1#a" data-discover="true">站内</a>');
  expect(html).toContain('<a href="/movies" data-discover="true">本站全址</a>');
  expect(html).toContain("<p><strong>标题</strong></p>");
  expect(html).toContain("第一行<br/>");
  expect(html).toMatch(/<code>code<\/code> <del>删<\/del>/u);
});

// A comment lives on the watch page, so its fragment and relative links read from there instead of the site root.
it("resolves fragment and relative links against the page they are read on", () => {
  vi.stubGlobal("window", { location: { origin: "https://archive.test", href: "https://archive.test/watch/u1?t=5" } });
  const body = "[锚点](#comments) [相对](other) [上级](../series)";
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CommentBody, { body })));
  vi.unstubAllGlobals();

  expect(html).toContain('<a href="/watch/u1?t=5#comments" data-discover="true">锚点</a>');
  expect(html).toContain('<a href="/watch/other" data-discover="true">相对</a>');
  expect(html).toContain('<a href="/series" data-discover="true">上级</a>');
});

// B 6.12.2 treats every `//host` link as external, this site's own host included.
it("opens a protocol-relative link to this site outside the app", () => {
  vi.stubGlobal("window", { location: { origin: "https://archive.test" } });
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CommentBody, { body: "[本站协议相对](//archive.test/movies)" })));
  vi.unstubAllGlobals();

  expect(html).toContain('<a href="//archive.test/movies" target="_blank" rel="nofollow ugc noopener noreferrer">本站协议相对</a>');
});
