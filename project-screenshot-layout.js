export function detectProjectScreenshotKeyColumns(
  data,
  width,
  height,
  bounds = { x: 0, y: 0, width, height },
) {
  const startX = Math.max(0, bounds.x);
  const endX = Math.min(width, bounds.x + bounds.width);
  const startY = Math.max(0, bounds.y);
  const endY = Math.min(height, bounds.y + bounds.height);
  const regionHeight = Math.max(1, endY - startY);
  const sampleStep = Math.max(3, Math.floor(regionHeight / 220));
  const sampleCount = Math.ceil(regionHeight / sampleStep);
  const binCount = Math.min(8, Math.max(1, sampleCount));
  const edgeOffset = 3;
  const lineXs = [];
  for (let x = startX; x < endX; x += 1) {
    let strong = 0;
    let light = 0;
    const strongBins = new Uint16Array(binCount);
    const lightBins = new Uint16Array(binCount);
    const totalBins = new Uint16Array(binCount);
    let sampleIndex = 0;
    for (let y = startY; y < endY; y += sampleStep) {
      const bin = Math.min(binCount - 1, Math.floor(sampleIndex * binCount / sampleCount));
      const offset = (y * width + x) * 4;
      const gray = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
      const leftGray = projectScreenshotGrayAt(data, width, Math.max(startX, x - edgeOffset), y);
      const rightGray = projectScreenshotGrayAt(data, width, Math.min(endX - 1, x + edgeOffset), y);
      const localContrast = Math.max(leftGray, rightGray) - gray;
      totalBins[bin] += 1;
      if (gray < 170 || localContrast >= 38) {
        strong += 1;
        strongBins[bin] += 1;
      }
      if (gray < 232 || localContrast >= 12) {
        light += 1;
        lightBins[bin] += 1;
      }
      sampleIndex += 1;
    }
    if (projectScreenshotLineCoverageMatches({
      strong,
      light,
      sampleCount,
      strongBins,
      lightBins,
      totalBins,
      strongThreshold: 0.28,
      lightThreshold: 0.62,
    })) lineXs.push(x);
  }
  const rawLines = mergeLinePositions(lineXs);
  return selectProjectScreenshotKeyColumns(rawLines, startX, endX - 1);
}

export function buildProjectScreenshotAnalysisTiles(
  width,
  height,
  { maxPixels = 1_600_000, maxWidth = 1_300, maxHeight = 1_900 } = {},
) {
  const sourceWidth = Math.max(1, Number(width) || 1);
  const sourceHeight = Math.max(1, Number(height) || 1);
  const scale = Math.min(1, Math.max(Number.EPSILON, maxWidth / sourceWidth));
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeightLimit = Math.max(64, Math.min(
    maxHeight,
    Math.floor(maxPixels / targetWidth),
  ));
  const sourceTileHeight = Math.max(1, Math.floor(targetHeightLimit / scale));
  if (sourceHeight <= sourceTileHeight) return [{ y: 0, height: sourceHeight, scale }];

  const overlap = Math.min(
    Math.round(sourceTileHeight * 0.08),
    Math.max(40, Math.round(160 / scale)),
  );
  const stride = Math.max(1, sourceTileHeight - overlap);
  const tiles = [];
  for (let y = 0; y < sourceHeight; y += stride) {
    const remaining = sourceHeight - y;
    const tileHeight = Math.min(sourceTileHeight, remaining);
    tiles.push({ y, height: tileHeight, scale });
    if (tileHeight >= remaining) break;
  }
  return tiles;
}

export function projectScreenshotLineCoverageMatches({
  strong = 0,
  light = 0,
  sampleCount = 1,
  strongBins = [],
  lightBins = [],
  totalBins = [],
  strongThreshold = 0.28,
  lightThreshold = 0.62,
} = {}) {
  const total = Math.max(1, sampleCount);
  if (strong / total > strongThreshold || light / total > lightThreshold) return true;
  const binCount = Math.max(1, totalBins.length || lightBins.length || strongBins.length);
  const requiredBins = Math.max(2, Math.ceil(binCount * 0.625));
  const distributedStrong = Array.from({ length: binCount }, (_, index) => (
    (strongBins[index] || 0) / Math.max(1, totalBins[index] || 0) > strongThreshold * 0.82
  )).filter(Boolean).length;
  const distributedLight = Array.from({ length: binCount }, (_, index) => (
    (lightBins[index] || 0) / Math.max(1, totalBins[index] || 0) > lightThreshold * 0.82
  )).filter(Boolean).length;
  return distributedStrong >= requiredBins || distributedLight >= requiredBins;
}

export function selectProjectScreenshotKeyColumns(rawLines = [], start = 0, end = 0) {
  const lines = normalizeProjectScreenshotTableLines(rawLines, start, end);
  const regionWidth = Math.max(1, end - start + 1);
  const minBranchWidth = Math.max(30, regionWidth * 0.02);
  const maxBranchWidth = Math.max(120, regionWidth * 0.22);
  const minNameWidth = Math.max(120, regionWidth * 0.08);
  const maxNameWidth = Math.max(420, regionWidth * 0.6);
  let best = null;

  for (let index = 0; index < lines.length - 2; index += 1) {
    const left = lines[index];
    const branchRight = lines[index + 1];
    const nameRight = lines[index + 2];
    const branchWidth = branchRight - left;
    const nameWidth = nameRight - branchRight;
    if (left > start + regionWidth * 0.3) continue;
    if (branchWidth < minBranchWidth || branchWidth > maxBranchWidth) continue;
    if (nameWidth < minNameWidth || nameWidth > maxNameWidth) continue;
    const score = Math.abs(left - start)
      + Math.abs(branchWidth - regionWidth * 0.09)
      + Math.abs(nameWidth - regionWidth * 0.34)
      + (nameWidth < branchWidth * 1.8 ? regionWidth * 0.35 : 0);
    if (!best || score < best.score) best = { left, branchRight, nameRight, score };
  }

  if (!best) return null;
  return {
    branch: insetProjectScreenshotColumn(best.left, best.branchRight, regionWidth),
    name: insetProjectScreenshotColumn(best.branchRight, best.nameRight, regionWidth),
  };
}

export function normalizeProjectScreenshotTableLines(lines = [], start = 0, end = 0) {
  const normalized = Array.from(new Set(lines))
    .filter((line) => Number.isFinite(line))
    .sort((left, right) => left - right);
  const width = Math.max(1, end - start + 1);
  if (!normalized.length || normalized[0] > start + Math.max(6, width * 0.004)) normalized.unshift(start);
  if (normalized.at(-1) < end - Math.max(6, width * 0.004)) normalized.push(end);
  return normalized;
}

function insetProjectScreenshotColumn(left, right, imageWidth) {
  const inset = Math.max(2, Math.round(imageWidth * 0.0007));
  const x = Math.max(0, left + inset);
  const maxRight = Math.max(x + 1, right - inset);
  return { x, width: maxRight - x };
}

function projectScreenshotGrayAt(data, width, x, y) {
  const offset = (y * width + x) * 4;
  return data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
}

function mergeLinePositions(positions = []) {
  const lines = [];
  let group = [];
  for (const position of positions) {
    if (!group.length || position <= group.at(-1) + 1) {
      group.push(position);
    } else {
      lines.push(Math.round(group.reduce((sum, value) => sum + value, 0) / group.length));
      group = [position];
    }
  }
  if (group.length) lines.push(Math.round(group.reduce((sum, value) => sum + value, 0) / group.length));
  return lines;
}
