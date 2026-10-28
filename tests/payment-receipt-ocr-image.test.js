import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePaymentReceiptOcrImage, PAYMENT_RECEIPT_OCR_IMAGE_MAX_BYTES } from '../payment-receipt-ocr-image.js';

function jpeg(width, height, length = 23) {
  const bytes = new Uint8Array(length);
  bytes.set([255, 216, 255, 192, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255,
    3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217]);
  return bytes;
}
const image = (width = 4956, height = 7009, bytes = jpeg(width, height)) => ({ bytes, width, height,
  mimeType: 'image/jpeg', source: 'jpeg-xobject', rotation: 0 });
function binding(output = jpeg(2263, 3200)) {
  const calls = [], streams = [];
  const IMAGES = {
    input(stream) {
      streams.push(stream);
      const handle = {
        transform(options) { calls.push({ transform: options }); return handle; },
        async output(options) { calls.push({ output: options }); return {
          response(options) { calls.push({ response: options }); return output instanceof Response ? output : new Response(output, { headers: { 'Content-Type': 'image/jpeg' } }); },
        }; },
      };
      return handle;
    },
  };
  return { IMAGES, calls, streams };
}

test('normal OCR images and absent extracted scans pass through without any transformation or inference', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('must not call a public URL or an AI service'); });
  const h = binding(), source = image(2000, 2800);
  assert.equal(await preparePaymentReceiptOcrImage(h, source), source);
  assert.equal(await preparePaymentReceiptOcrImage({}, source), source);
  assert.equal(await preparePaymentReceiptOcrImage({}, null), null);
  assert.equal(h.calls.length, 0);
});

test('the actual 4956×7009 oversized scan gets a private aspect-preserving readable OCR copy', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('image content must remain private'); });
  const source = image(), original = source.bytes.slice(), h = binding();
  const result = await preparePaymentReceiptOcrImage(h, source);
  assert.equal(result.resized, true);
  assert.equal(result.width, 2263);
  assert.equal(result.height, 3200);
  assert.equal(result.sourceWidth, 4956);
  assert.equal(result.sourceHeight, 7009);
  assert.equal(result.source, 'jpeg-xobject');
  assert.equal(result.mimeType, 'image/jpeg');
  assert.deepEqual(source.bytes, original);
  assert.equal(source.width, 4956);
  assert.equal(source.resized, undefined);
  assert.deepEqual(h.calls, [
    { transform: { width: 2400, height: 3200, fit: 'scale-down' } },
    { output: { format: 'image/jpeg', quality: 90 } },
    { response: { headers: { 'Cache-Control': 'private, no-store' } } },
  ]);
  assert.ok(h.streams[0] instanceof ReadableStream);
  assert.deepEqual(new Uint8Array(await new Response(h.streams[0]).arrayBuffer()), original);
});

test('encoded dimensions take priority over stale PDF dictionary metadata', async () => {
  const source = image(); source.width = 2; source.height = 2;
  const h = binding(), result = await preparePaymentReceiptOcrImage(h, source);
  assert.equal(result.resized, true);
  assert.equal(result.sourceWidth, 4956);
  assert.equal(result.sourceHeight, 7009);
});

test('landscape scans use landscape bounds without cropping, rotation or enlargement', async () => {
  const source = image(7009, 4956), h = binding(jpeg(3200, 2263));
  const result = await preparePaymentReceiptOcrImage(h, source);
  assert.equal(result.rotation, 0);
  assert.deepEqual(h.calls[0].transform, { width: 3200, height: 2400, fit: 'scale-down' });
  assert.equal(result.width, 3200);
  assert.equal(result.height, 2263);
});

test('large compressed bytes alone trigger recompression even when pixel dimensions already fit', async () => {
  const source = image(2000, 2800, jpeg(2000, 2800, PAYMENT_RECEIPT_OCR_IMAGE_MAX_BYTES + 1)), h = binding(jpeg(2000, 2800));
  const result = await preparePaymentReceiptOcrImage(h, source);
  assert.equal(result.resized, true);
  assert.equal(result.width, 2000);
  assert.equal(result.height, 2800);
  assert.equal(source.bytes.byteLength, PAYMENT_RECEIPT_OCR_IMAGE_MAX_BYTES + 1);
});

test('compressed 100MP images are handled without a 40MP Worker pixel-allocation limit', async () => {
  const h = binding(jpeg(2400, 2400));
  const result = await preparePaymentReceiptOcrImage(h, image(10000, 10000));
  assert.equal(result.width, 2400);
  assert.equal(result.height, 2400);
});

test('oversized images with a missing binding fail clearly without exposing bytes or source text', async () => {
  const source = { ...image(), filename: 'PRIVATE_DOCUMENT_NAME', text: 'PRIVATE_ACCOUNT_NUMBER' };
  await assert.rejects(preparePaymentReceiptOcrImage({}, source), error => {
    assert.equal(error.code, 'PAYMENT_RECEIPT_IMAGE_CONFIG');
    assert.equal(error.status, 503);
    assert.equal(error.nonRetryable, true);
    assert.doesNotMatch(error.message, /PRIVATE_|base64|data:image/);
    assert.match(error.message, /图像缩放服务尚未配置/);
    return true;
  });
});

test('source byte, area and edge bounds stop unsupported images before using a service', async () => {
  const h = binding();
  for (const source of [image(12000, 9000), image(12001, 1000), image(4956, 7009, jpeg(4956, 7009, 20_000_001))]) {
    await assert.rejects(preparePaymentReceiptOcrImage(h, source), error => error.code === 'PAYMENT_RECEIPT_IMAGE_SOURCE_LIMIT');
  }
  assert.equal(h.calls.length, 0);
});

test('malformed image formats and metadata are rejected without reading a public URL', async () => {
  for (const source of [{ ...image(), bytes: new Uint8Array() }, { ...image(), mimeType: 'image/svg+xml' },
    { ...image(), bytes: new Uint8Array([1, 2, 3]) }, { ...image(), bytes: new Uint8Array([255, 216, 255, 217]), width: 0 }]) {
    await assert.rejects(preparePaymentReceiptOcrImage({}, source), error => error.code === 'PAYMENT_RECEIPT_IMAGE_INPUT');
  }
});

test('processor failures expose only a fixed service error', async () => {
  const h = { IMAGES: { input() { throw Error('PRIVATE_PROVIDER_TOKEN and PRIVATE_DOCUMENT_CONTENT'); } } };
  await assert.rejects(preparePaymentReceiptOcrImage(h, image()), error => {
    assert.equal(error.code, 'PAYMENT_RECEIPT_IMAGE_PROCESSING');
    assert.doesNotMatch(error.message, /PRIVATE_/);
    return true;
  });
});

test('a processor ignoring resize bounds, changing aspect ratio or returning invalid bytes is rejected', async () => {
  for (const bytes of [jpeg(4956, 7009), jpeg(2400, 3200), new Uint8Array([1, 2, 3])]) {
    await assert.rejects(preparePaymentReceiptOcrImage(binding(bytes), image()), error => error.code === 'PAYMENT_RECEIPT_IMAGE_OUTPUT');
  }
});

test('oversized Content-Length cancels the output stream before buffering', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
    headers: { 'Content-Length': String(PAYMENT_RECEIPT_OCR_IMAGE_MAX_BYTES + 1) },
  });
  await assert.rejects(preparePaymentReceiptOcrImage(binding(response), image()), error => error.code === 'PAYMENT_RECEIPT_IMAGE_OUTPUT_LIMIT');
  assert.equal(cancelled, true);
});

test('chunked output is bounded even without a Content-Length header', async () => {
  let count = 0, cancelled = false;
  const response = new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(count++ ? 3_000_000 : 8_000_000)); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(preparePaymentReceiptOcrImage(binding(response), image()), error => error.code === 'PAYMENT_RECEIPT_IMAGE_OUTPUT_LIMIT');
  assert.equal(cancelled, true);
});

test('a stalled transformation has a deadline and preserves the source object', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const source = image(), h = { IMAGES: { input() { return { transform() { return this; }, output() { return new Promise(() => {}); } }; } } };
  const running = preparePaymentReceiptOcrImage(h, source);
  t.mock.timers.tick(30001);
  await assert.rejects(running, error => error.code === 'PAYMENT_RECEIPT_IMAGE_TIMEOUT');
  assert.equal(source.width, 4956);
  assert.equal(source.height, 7009);
});
