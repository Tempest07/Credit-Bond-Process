import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, rgb } from 'pdf-lib';
import { extractPaymentReceiptFlateImage, encodePaymentReceiptRgbaPng } from '../payment-receipt-flate-image.js';

async function compressed(bytes) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
}

async function fixture(options = {}) {
  const document = await PDFDocument.create(), page = document.addPage([100, 100]);
  const width = options.width || 2, height = options.height || 2;
  const pixels = options.pixels || new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
  const dictionary = { Type: 'XObject', Subtype: 'Image', Width: width, Height: height,
    BitsPerComponent: 8, ColorSpace: 'DeviceRGB', Filter: options.filter || 'FlateDecode' };
  if (options.alpha) dictionary.SMask = document.context.register(document.context.stream(await compressed(options.alpha), {
    Type: 'XObject', Subtype: 'Image', Width: width, Height: height, BitsPerComponent: 8, ColorSpace: 'DeviceGray', Filter: 'FlateDecode',
  }));
  const reference = document.context.register(document.context.stream(await compressed(pixels), dictionary));
  let painted = reference;
  if (options.form) painted = document.context.register(document.context.stream(new TextEncoder().encode('/Inner Do'), {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1, 1], Resources: { XObject: { Inner: reference } },
  }));
  const name = page.node.newXObject('Scan', painted);
  const box = options.box || [100, 100, 0, 0];
  const paint = `q ${box[0]} 0 0 ${box[1]} ${box[2]} ${box[3]} cm ${name} Do Q`;
  page.node.addContentStream(document.context.register(document.context.stream(new TextEncoder().encode(options.unpainted ? '' : paint + (options.repeat ? '\n' + paint : '')))));
  if (options.text) page.drawText('Visible overlay', { x: 10, y: 10, size: 8 });
  if (options.vector) page.drawRectangle({ x: 10, y: 10, width: 20, height: 10, color: rgb(0, 0, 0) });
  if (options.annotation) page.node.addAnnot(document.context.register(document.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: 'Visible note', Name: 'Note',
  })));
  if (options.multipage) document.addPage([100, 100]);
  return document.save();
}

async function decodePng(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), data = [];
  let width, height;
  for (let offset = 8; offset < bytes.length;) {
    const size = view.getUint32(offset), type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    const chunk = bytes.subarray(offset + 8, offset + 8 + size);
    if (type === 'IHDR') { width = new DataView(chunk.buffer, chunk.byteOffset).getUint32(0); height = new DataView(chunk.buffer, chunk.byteOffset).getUint32(4); assert.equal(chunk[9], 2); }
    if (type === 'IDAT') data.push(chunk);
    offset += size + 12;
  }
  const rows = new Uint8Array(await new Response(new Blob(data).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const pixels = [];
  for (let y = 0; y < height; y++) { assert.equal(rows[y * (width * 3 + 1)], 0); for (let x = 0; x < width; x++) pixels.push([...rows.subarray(y * (width * 3 + 1) + x * 3 + 1, y * (width * 3 + 1) + x * 3 + 4)]); }
  return { width, height, pixels };
}

test('full-page Flate RGB scans are recovered locally with their visible colours and no source mutation', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw Error('No public image URL or AI call allowed'); });
  const source = await fixture(), before = source.slice(), image = await extractPaymentReceiptFlateImage(source);
  assert.equal(image.source, 'pdfjs-flate-scan');
  assert.equal(image.mimeType, 'image/png');
  assert.equal(image.rotation, 0);
  assert.deepEqual(source, before);
  assert.deepEqual((await decodePng(image.bytes)).pixels, [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]]);
});

test('soft masks retain red ink and blend transparent scan borders against the white PDF page', async () => {
  const source = await fixture({ pixels: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0]), alpha: new Uint8Array([255, 0, 128, 255]) });
  const image = await extractPaymentReceiptFlateImage(source);
  assert.ok(image, 'a real SMask must not exclude an otherwise full-page scan');
  assert.deepEqual((await decodePng(image.bytes)).pixels, [[255, 0, 0], [255, 255, 255], [255, 127, 127], [255, 0, 0]]);
});

test('nested Form XObjects preserve their actual full-page scan', async () => {
  const image = await extractPaymentReceiptFlateImage(await fixture({ form: true }));
  assert.ok(image);
  assert.deepEqual((await decodePng(image.bytes)).pixels[0], [255, 0, 0]);
});

test('page placement preserves an upper margin and clips image pixels outside the page', async () => {
  const pixels = new Uint8Array(10 * 10 * 3);
  for (let index = 0; index < 100; index++) pixels.set(index < 90 ? [255, 0, 0] : [0, 0, 255], index * 3);
  const image = await extractPaymentReceiptFlateImage(await fixture({ width: 10, height: 10, pixels, box: [100, 100, 0, -10] }));
  const decoded = await decodePng(image.bytes);
  assert.deepEqual(decoded.pixels[0], [255, 255, 255], 'the page margin is not stretched away');
  assert.deepEqual(decoded.pixels[10], [255, 0, 0]);
  assert.deepEqual(decoded.pixels[99], [255, 0, 0], 'off-page blue pixels are clipped rather than exposed to OCR');
});

test('native text, vectors and annotations are never silently dropped from a page image', async () => {
  for (const options of [{ text: true }, { vector: true }, { annotation: true }]) {
    assert.equal(await extractPaymentReceiptFlateImage(await fixture(options)), null);
  }
});

test('small logos, multiple painted images and unused image resources are not mistaken for the entire page', async () => {
  for (const options of [{ box: [30, 30, 0, 0] }, { repeat: true }, { unpainted: true }]) {
    assert.equal(await extractPaymentReceiptFlateImage(await fixture(options)), null);
  }
});

test('unsupported, malformed, multipage and oversized inputs remain unavailable rather than becoming blank', async () => {
  const empty = await PDFDocument.create(); empty.addPage([100, 100]);
  for (const bytes of [new Uint8Array(), new Uint8Array([1, 2, 3]), new Uint8Array(20 * 1024 * 1024 + 1),
    await empty.save(), await fixture({ multipage: true }), await fixture({ width: 2001, height: 2000 }), await fixture({ filter: 'DCTDecode' })]) {
    assert.equal(await extractPaymentReceiptFlateImage(bytes), null);
  }
});

test('the opaque PNG encoder physically rotates the page and enforces pixel bounds', async () => {
  const rgba = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]);
  const image = await encodePaymentReceiptRgbaPng(rgba, 2, 1, 90), decoded = await decodePng(image.bytes);
  assert.equal(decoded.width, 1); assert.equal(decoded.height, 2);
  assert.deepEqual(decoded.pixels, [[255, 0, 0], [0, 0, 255]]);
  await assert.rejects(encodePaymentReceiptRgbaPng(new Uint8Array(), 2001, 2000), /Invalid bounded/);
  await assert.rejects(encodePaymentReceiptRgbaPng(rgba, 2, 1, 45), /rotation/);
});
