export function inspectProjectScreenshotImageHeader(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || 0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return { format: "png", width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 10 && (
    String.fromCharCode(...bytes.slice(0, 6)) === "GIF87a"
    || String.fromCharCode(...bytes.slice(0, 6)) === "GIF89a"
  )) {
    return { format: "gif", width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return {
      format: "bmp",
      width: Math.abs(view.getInt32(18, true)),
      height: Math.abs(view.getInt32(22, true)),
    };
  }
  if (bytes.length >= 30
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    const kind = String.fromCharCode(...bytes.slice(12, 16));
    if (kind === "VP8X") {
      const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
      return { format: "webp", width, height };
    }
    if (kind === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return {
        format: "webp",
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    }
    if (kind === "VP8L" && bytes[20] === 0x2f) {
      return {
        format: "webp",
        width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
        height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
      };
    }
    return { format: "webp", width: 0, height: 0 };
  }
  const tiff = inspectProjectScreenshotTiffHeader(bytes, view);
  if (tiff) return tiff;
  const isoMedia = inspectProjectScreenshotIsoMediaHeader(bytes, view);
  if (isoMedia) return isoMedia;
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) break;
      const marker = bytes[offset];
      offset += 1;
      if (marker === 0xd8 || marker === 0x01) continue;
      if (marker === 0xd9 || marker === 0xda) break;
      if (offset + 1 >= bytes.length) break;
      const segmentLength = (bytes[offset] << 8) + bytes[offset + 1];
      if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return {
          format: "jpeg",
          width: (bytes[offset + 5] << 8) + bytes[offset + 6],
          height: (bytes[offset + 3] << 8) + bytes[offset + 4],
        };
      }
      offset += segmentLength;
    }
    return { format: "jpeg", width: 0, height: 0 };
  }
  return null;
}

function inspectProjectScreenshotTiffHeader(bytes, view) {
  if (bytes.length < 8) return null;
  const littleEndian = bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00;
  const bigEndian = bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a;
  if (!littleEndian && !bigEndian) return null;
  const ifdOffset = view.getUint32(4, littleEndian);
  if (ifdOffset + 2 > bytes.length) return { format: "tiff", width: 0, height: 0 };
  const count = view.getUint16(ifdOffset, littleEndian);
  let width = 0;
  let height = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = ifdOffset + 2 + index * 12;
    if (offset + 12 > bytes.length) break;
    const tag = view.getUint16(offset, littleEndian);
    if (tag !== 256 && tag !== 257) continue;
    const type = view.getUint16(offset + 2, littleEndian);
    const valueCount = view.getUint32(offset + 4, littleEndian);
    if (valueCount !== 1 || (type !== 3 && type !== 4)) continue;
    const value = type === 3
      ? view.getUint16(offset + 8, littleEndian)
      : view.getUint32(offset + 8, littleEndian);
    if (tag === 256) width = value;
    else height = value;
  }
  return { format: "tiff", width, height };
}

function inspectProjectScreenshotIsoMediaHeader(bytes, view) {
  if (bytes.length < 32 || String.fromCharCode(...bytes.slice(4, 8)) !== "ftyp") return null;
  const brands = String.fromCharCode(...bytes.slice(8, Math.min(bytes.length, 40))).toLowerCase();
  const format = /avif|avis/.test(brands) ? "avif" : /heic|heix|hevc|hevx|mif1/.test(brands) ? "heic" : "";
  if (!format) return null;
  for (let offset = 4; offset + 16 <= bytes.length; offset += 1) {
    if (String.fromCharCode(...bytes.slice(offset, offset + 4)) !== "ispe") continue;
    const width = view.getUint32(offset + 8);
    const height = view.getUint32(offset + 12);
    if (width && height) return { format, width, height };
  }
  return { format, width: 0, height: 0 };
}

export function projectScreenshotResizeDimensions(
  width,
  height,
  { maxPixels = 18_000_000, maxDimension = 16_000 } = {},
) {
  const sourceWidth = Number(width);
  const sourceHeight = Number(height);
  if (!Number.isFinite(sourceWidth) || sourceWidth <= 0 || !Number.isFinite(sourceHeight) || sourceHeight <= 0) return null;
  const scale = Math.min(
    1,
    Math.sqrt(maxPixels / (sourceWidth * sourceHeight)),
    maxDimension / Math.max(sourceWidth, sourceHeight),
  );
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    scale,
  };
}

export function projectScreenshotResizeRetainsReadableWidth(
  sourceWidth,
  resizedWidth,
  minimumReadableWidth = 900,
) {
  const source = Number(sourceWidth);
  const resized = Number(resizedWidth);
  const minimum = Number(minimumReadableWidth);
  if (![source, resized, minimum].every(Number.isFinite) || source <= 0 || resized <= 0 || minimum <= 0) return false;
  return resized >= Math.min(minimum, source * 0.75);
}

export function projectScreenshotCompositeBackground(transparentRatio, visibleMedian) {
  const transparency = Number(transparentRatio);
  const median = Number(visibleMedian);
  if (!Number.isFinite(transparency) || !Number.isFinite(median)) return "#fff";
  if (transparency >= 0.02) return median >= 160 ? "#111827" : "#fff";
  return median < 128 ? "#111827" : "#fff";
}
