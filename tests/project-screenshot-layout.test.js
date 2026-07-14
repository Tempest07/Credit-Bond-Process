import assert from "node:assert/strict";
import test from "node:test";

import {
  detectProjectScreenshotKeyColumns,
  normalizeProjectScreenshotTableLines,
  selectProjectScreenshotKeyColumns,
} from "../project-screenshot-layout.js";

test("does not mistake screenshot whitespace for the branch column", () => {
  const columns = selectProjectScreenshotKeyColumns(
    [55, 275, 1305, 1575, 1815, 2145],
    0,
    2199,
  );
  assert.deepEqual(columns, {
    branch: { x: 57, width: 216 },
    name: { x: 277, width: 1026 },
  });
});

test("still accepts a compact full-table branch and name layout", () => {
  const columns = selectProjectScreenshotKeyColumns(
    [0, 90, 430, 760, 1000],
    0,
    999,
  );
  assert.deepEqual(columns, {
    branch: { x: 2, width: 86 },
    name: { x: 92, width: 336 },
  });
});

test("skips a leading business column before branch and bond name", () => {
  const columns = selectProjectScreenshotKeyColumns(
    [0, 190, 410, 1360, 1680, 2199],
    0,
    2199,
  );
  assert.deepEqual(columns, {
    branch: { x: 192, width: 216 },
    name: { x: 412, width: 946 },
  });
});

test("normalizes missing screenshot edges without changing real grid lines", () => {
  assert.deepEqual(normalizeProjectScreenshotTableLines([55, 275, 1305], 0, 2199), [0, 55, 275, 1305, 2199]);
});

test("detects branch and name columns from synthetic screenshot pixels", () => {
  const width = 2200;
  const height = 120;
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  for (const x of [0, 190, 410, 1360, 1680, 2199]) {
    for (let y = 0; y < height; y += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = 80;
      data[offset + 1] = 80;
      data[offset + 2] = 80;
    }
  }
  assert.deepEqual(detectProjectScreenshotKeyColumns(data, width, height), {
    branch: { x: 192, width: 216 },
    name: { x: 412, width: 946 },
  });
});

test("detects light dashed table columns distributed across the screenshot", () => {
  const width = 2200;
  const height = 120;
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  for (const x of [0, 190, 410, 1360, 1680, 2199]) {
    for (let y = 0; y < height; y += 1) {
      if (Math.floor(y / 3) % 3 === 2) continue;
      const offset = (y * width + x) * 4;
      data[offset] = 220;
      data[offset + 1] = 220;
      data[offset + 2] = 220;
    }
  }
  assert.deepEqual(detectProjectScreenshotKeyColumns(data, width, height), {
    branch: { x: 192, width: 216 },
    name: { x: 412, width: 946 },
  });
});
