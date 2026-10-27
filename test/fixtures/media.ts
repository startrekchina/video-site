// Metadata-only fixture: samples remain H.264, so this must not be used for browser decoding tests.
export function asVp9(bytes: Uint8Array) {
  const text = new TextEncoder(), find = (type: string, from = 0) => bytes.findIndex((_, n) => n >= from && String.fromCharCode(...bytes.subarray(n, n + 4)) === type);
  const entry = find("avc1", find("stsd")), config = find("avcC", entry) - 4, view = new DataView(bytes.buffer), size = view.getUint32(config);
  bytes.set(text.encode("vp09"), entry);
  bytes.set([0, 0, 0, 20, ...text.encode("vpcC"), 1, 0, 0, 0, 0, 10, 0x82, 2, 2, 2, 0, 0, 0, 0, 0, 0, ...text.encode("free")], config);
  view.setUint32(config + 20, size - 20);
  return bytes;
}
