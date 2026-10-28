import { PDFDocument, PDFDict, PDFName, PDFRawStream } from 'pdf-lib';

const MAX_PAGE_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 4_000_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/** Recover a small full-page Flate scan, including its soft mask. A missing
 * image is never evidence of a blank page. Native text/other visible overlays
 * stay with the normal PDF reader rather than being silently dropped here. */
export async function extractPaymentReceiptFlateImage(pageBytes, rotation = 0) {
  const bytes = pageBytes instanceof Uint8Array ? pageBytes : new Uint8Array(pageBytes || 0);
  if (!bytes.length || bytes.length > MAX_PAGE_BYTES) return null;
  let pdf, timer, stopped = false;
  try {
    const document = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    if (document.getPageCount() !== 1) return null;
    const resources = document.getPages()[0].node.Resources();
    const images = flateImages(document.context, resources?.lookupMaybe(PDFName.of('XObject'), PDFDict));
    if (!images.length || images.reduce((sum, image) => sum + image.width * image.height, 0) > MAX_PIXELS) return null;
    const task = (async () => {
      const { getDocumentProxy, getResolvedPDFJS, extractImages } = await import('unpdf');
      if (stopped) return null;
      pdf = await getDocumentProxy(bytes.slice(), { isEvalSupported: false, maxImageSize: MAX_PIXELS,
        isOffscreenCanvasSupported: false, isImageDecoderSupported: false, disableFontFace: true });
      if (stopped) return null;
      const page = await pdf.getPage(1);
      const [operators, annotations] = await Promise.all([page.getOperatorList(), page.getAnnotations()]);
      const { OPS } = await getResolvedPDFJS();
      const otherPaint = new Set(['showText', 'showSpacedText', 'nextLineShowText', 'nextLineSetSpacingShowText',
        'stroke', 'closeStroke', 'fill', 'eoFill', 'fillStroke', 'eoFillStroke', 'closeFillStroke',
        'closeEOFillStroke', 'shadingFill', 'paintImageMaskXObject', 'paintSolidColorImageMask'].map(name => OPS[name]).filter(Number.isInteger));
      if (annotations.length || operators.fnArray.some((op, index) => otherPaint.has(op)
        || op === OPS.constructPath && operators.argsArray[index]?.[0] !== OPS.endPath)) return null;
      const decoded = await extractImages(pdf, 1);
      if (stopped || decoded.length !== 1) return null;
      const image = decoded[0], bounds = image.bounds, view = page.view;
      if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1
        || image.width * image.height > MAX_PIXELS || image.data.length !== image.width * image.height * 4
        || !bounds || ![bounds.x, bounds.y, bounds.width, bounds.height, ...view].every(Number.isFinite)
        || bounds.width <= 0 || bounds.height <= 0) return null;
      const pageWidth = view[2] - view[0], pageHeight = view[3] - view[1];
      if (pageWidth <= 0 || pageHeight <= 0) return null;
      const overlapWidth = Math.max(0, Math.min(view[2], bounds.x + bounds.width) - Math.max(view[0], bounds.x));
      const overlapHeight = Math.max(0, Math.min(view[3], bounds.y + bounds.height) - Math.max(view[1], bounds.y));
      if (overlapWidth * overlapHeight / (pageWidth * pageHeight) < 0.8
        || Math.abs((bounds.width / bounds.height) / (image.width / image.height) - 1) > 0.03) return null;
      const scale = Math.min(Math.max(image.width / bounds.width, image.height / bounds.height),
        Math.sqrt(MAX_PIXELS / (pageWidth * pageHeight)), 3200 / Math.max(pageWidth, pageHeight));
      const width = Math.max(1, Math.round(pageWidth * scale)), height = Math.max(1, Math.round(pageHeight * scale));
      const rgba = new Uint8Array(width * height * 4); rgba.fill(255);
      // Place the decoded image onto the original page box. This preserves
      // margins and off-page clipping instead of returning an uncropped scan.
      for (let y = 0; y < height; y++) {
        const pdfY = view[3] - (y + 0.5) * pageHeight / height;
        const sy = Math.floor((bounds.y + bounds.height - pdfY) / bounds.height * image.height);
        if (sy < 0 || sy >= image.height) continue;
        for (let x = 0; x < width; x++) {
          const pdfX = view[0] + (x + 0.5) * pageWidth / width;
          const sx = Math.floor((pdfX - bounds.x) / bounds.width * image.width);
          if (sx < 0 || sx >= image.width) continue;
          rgba.set(image.data.subarray((sy * image.width + sx) * 4, (sy * image.width + sx) * 4 + 4), (y * width + x) * 4);
        }
      }
      const png = await encodePaymentReceiptRgbaPng(rgba, width, height, rotation);
      return stopped ? null : { ...png, mimeType: 'image/png', rotation: 0, source: 'pdfjs-flate-scan' };
    })();
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Flate page extraction timed out')), 15000); });
    return await Promise.race([task, deadline]);
  } catch { return null; }
  finally { stopped = true; clearTimeout(timer); await pdf?.loadingTask?.destroy().catch(() => {}); }
}

function flateImages(context, objects, visited = new Set()) {
  const result = [];
  for (const [, reference] of objects?.entries() || []) {
    const key = String(reference); if (visited.has(key)) continue; visited.add(key);
    const stream = context.lookup(reference); if (!(stream instanceof PDFRawStream)) continue;
    const subtype = String(stream.dict.get(PDFName.of('Subtype')) || '');
    if (subtype === '/Form') {
      const resources = stream.dict.lookupMaybe(PDFName.of('Resources'), PDFDict);
      result.push(...flateImages(context, resources?.lookupMaybe(PDFName.of('XObject'), PDFDict), visited));
    } else if (subtype === '/Image' && /\/FlateDecode\b/.test(String(stream.dict.get(PDFName.of('Filter')) || ''))
      && !/\/DCTDecode\b/.test(String(stream.dict.get(PDFName.of('Filter')) || ''))) {
      const width = Number(String(stream.dict.get(PDFName.of('Width')) || 0)), height = Number(String(stream.dict.get(PDFName.of('Height')) || 0));
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS) return [{ width: MAX_PIXELS + 1, height: 1 }];
      result.push({ width, height });
    }
  }
  return result;
}

/** Encode pixels against the PDF's white page, preserving red stamps and text.
 * The result is an opaque RGB PNG, independent of any browser/canvas runtime. */
export async function encodePaymentReceiptRgbaPng(rgba, width, height, rotation = 0) {
  if (!(rgba instanceof Uint8Array) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width * height > MAX_PIXELS || rgba.length !== width * height * 4) throw Error('Invalid bounded RGBA image');
  const angle = ((Number(rotation) % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(angle)) throw Error('Unsupported page rotation');
  const outWidth = angle === 90 || angle === 270 ? height : width, outHeight = angle === 90 || angle === 270 ? width : height;
  const rows = new Uint8Array((outWidth * 3 + 1) * outHeight);
  for (let y = 0; y < outHeight; y++) for (let x = 0; x < outWidth; x++) {
    const sx = angle === 90 ? y : angle === 180 ? width - 1 - x : angle === 270 ? width - 1 - y : x;
    const sy = angle === 90 ? height - 1 - x : angle === 180 ? height - 1 - y : angle === 270 ? x : y;
    const offset = (sy * width + sx) * 4, alpha = rgba[offset + 3];
    const target = y * (outWidth * 3 + 1) + x * 3 + 1;
    for (let channel = 0; channel < 3; channel++) rows[target + channel] = Math.round((rgba[offset + channel] * alpha + 255 * (255 - alpha)) / 255);
  }
  const compressed = new Uint8Array(await new Response(new Blob([rows]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const header = new Uint8Array(13), view = new DataView(header.buffer); view.setUint32(0, outWidth); view.setUint32(4, outHeight); header[8] = 8; header[9] = 2;
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', compressed), pngChunk('IEND', new Uint8Array())];
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0); if (length > MAX_OUTPUT_BYTES) throw Error('PNG output too large');
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return { bytes, width: outWidth, height: outHeight };
}

function pngChunk(type, data) {
  const bytes = new Uint8Array(data.length + 12), view = new DataView(bytes.buffer); view.setUint32(0, data.length);
  bytes.set(new TextEncoder().encode(type), 4); bytes.set(data, 8);
  let crc = 0xffffffff; for (let index = 4; index < data.length + 8; index++) {
    crc ^= bytes[index]; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1;
  }
  view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0); return bytes;
}
