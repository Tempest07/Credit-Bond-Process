import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectProjectScreenshotImageHeader,
  projectScreenshotResizeDimensions,
} from "../project-screenshot-image.js";

test("reads PNG dimensions before allocating a full bitmap", () => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 1200);
  view.setUint32(20, 30000);
  assert.deepEqual(inspectProjectScreenshotImageHeader(bytes), {
    format: "png",
    width: 1200,
    height: 30000,
  });
});

test("reads GIF and JPEG dimensions without decoding image pixels", () => {
  const gif = new Uint8Array(10);
  gif.set([..."GIF89a"].map((character) => character.charCodeAt(0)));
  new DataView(gif.buffer).setUint16(6, 640, true);
  new DataView(gif.buffer).setUint16(8, 1200, true);
  assert.deepEqual(inspectProjectScreenshotImageHeader(gif), {
    format: "gif",
    width: 640,
    height: 1200,
  });

  const jpeg = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    0x04, 0xb0,
    0x02, 0x80,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
  assert.deepEqual(inspectProjectScreenshotImageHeader(jpeg), {
    format: "jpeg",
    width: 640,
    height: 1200,
  });
});

test("preflights TIFF and ISO media image dimensions", () => {
  const tiff = new Uint8Array(38);
  tiff.set([0x49, 0x49, 0x2a, 0x00]);
  const tiffView = new DataView(tiff.buffer);
  tiffView.setUint32(4, 8, true);
  tiffView.setUint16(8, 2, true);
  tiffView.setUint16(10, 256, true);
  tiffView.setUint16(12, 4, true);
  tiffView.setUint32(14, 1, true);
  tiffView.setUint32(18, 1200, true);
  tiffView.setUint16(22, 257, true);
  tiffView.setUint16(24, 4, true);
  tiffView.setUint32(26, 1, true);
  tiffView.setUint32(30, 30000, true);
  assert.deepEqual(inspectProjectScreenshotImageHeader(tiff), {
    format: "tiff",
    width: 1200,
    height: 30000,
  });

  const avif = new Uint8Array(48);
  avif.set([..."ftyp"].map((character) => character.charCodeAt(0)), 4);
  avif.set([..."avif"].map((character) => character.charCodeAt(0)), 8);
  avif.set([..."ispe"].map((character) => character.charCodeAt(0)), 32);
  const avifView = new DataView(avif.buffer);
  avifView.setUint32(36, 0); // FullBox version and flags.
  avifView.setUint32(40, 1200);
  avifView.setUint32(44, 30000);
  assert.deepEqual(inspectProjectScreenshotImageHeader(avif), {
    format: "avif",
    width: 1200,
    height: 30000,
  });
});

test("bounds decoded screenshot pixels while preserving aspect ratio", () => {
  const resized = projectScreenshotResizeDimensions(1200, 30000, {
    maxPixels: 18_000_000,
    maxDimension: 16000,
  });
  assert.deepEqual(resized, { width: 640, height: 16000, scale: 8 / 15 });
  assert.ok(resized.width * resized.height <= 18_000_000);
});

test("keeps ordinary screenshots at their source dimensions", () => {
  assert.deepEqual(projectScreenshotResizeDimensions(2200, 1655), {
    width: 2200,
    height: 1655,
    scale: 1,
  });
});
