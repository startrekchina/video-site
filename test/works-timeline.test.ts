import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { WorksTimeline } from "@/components/site/works-timeline";
import type { WorkCard } from "@/lib/catalog";

const series: WorkCard = { slug: "fictional-series", kind: "series", tmdbId: 930001,
  titleZh: "虚构剧集", titleEn: "Fictional Series", overviewZh: null, overviewEn: null,
  year: 1987, poster: "", code: "SVY", seasonCount: 2, episodeCount: 8, watchedCount: 0, favorite: false };
const movie: WorkCard = { ...series, slug: "fictional-movie", kind: "movie", tmdbId: 930002,
  titleZh: "虚构电影", titleEn: "Fictional Movie", code: "", seasonCount: 0, episodeCount: 1, runtimeMin: 121.00033 };
const render = (works: WorkCard[]) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(WorksTimeline, { works })));

it.each([
  { works: [series], labels: ["简称", "SVY"] },
  { works: [movie], labels: ["序号", "01"] },
  { works: [series, movie], labels: ["简称 / 序号", "SVY", "02"] },
  { works: [movie, series], labels: ["简称 / 序号", "01", "SVY"] },
])("renders type-appropriate timeline labels for $labels", ({ works, labels }) => {
  const html = render(works);
  const displayed = Array.from(html.matchAll(/<p\b[^>]*data-slot="timescale-age"[^>]*>(.*?)<\/p>/gs), match => match[1]);
  expect(displayed).toEqual([...labels, ...labels]);
});

it("formats fractional movie durations and keeps missing durations hidden", () => {
  const html = render([series, movie, { ...movie, slug: "missing-duration", runtimeMin: null }]);
  expect(html.match(/122 分钟/g)).toHaveLength(2);
  expect(html.match(/2 季/g)).toHaveLength(2);
  expect(html).not.toContain("121.00033");
  expect(html).not.toContain("时长暂缺");
});
