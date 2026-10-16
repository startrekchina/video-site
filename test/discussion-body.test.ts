import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { CommentBody } from "@/components/site/discussion/parts";

// Comments are stored as typed; this renderer is what keeps member Markdown from becoming page markup.
it("renders the comment Markdown subset and nothing that can run or embed", () => {
  vi.stubGlobal("window", { location: { origin: "https://archive.test" } });
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
