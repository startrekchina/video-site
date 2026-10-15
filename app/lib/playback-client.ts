// `<video>` and ArtPlayer cannot read HTTP status, so the player asks the same URL again on failure.
export function mediaErrorMessage(status: number) {
  if (status === 401 || status === 403) return "登录已失效，请重新登录。";
  if (status === 404) return "片源暂时无法播放。";
  return "播放连接中断。";
}

// ArtPlayer decodes any response body as VTT; fetch it here first so failures are visible.
export async function loadSubtitle(url: string): Promise<{ url: string } | { message: string; remove: boolean }> {
  let response: Response, body: ArrayBuffer | undefined;
  try {
    response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    if (response.ok) body = await response.arrayBuffer();
  } catch { return { message: "字幕加载失败，请再次选择该字幕。", remove: false }; }
  if (response.status === 404) return { message: "字幕已失效，已从字幕选项中移除。", remove: true };
  if (!body) return { message: response.status === 401 || response.status === 403 ? mediaErrorMessage(response.status) : "字幕加载失败，请再次选择该字幕。", remove: false };
  return { url: URL.createObjectURL(new Blob([body], { type: "text/vtt" })) };
}
