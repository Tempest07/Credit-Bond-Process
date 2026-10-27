import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const modelsUrl = 'https://api.deepseek.com/models';
const names = ['OCR_AI_PROVIDER', 'DEEPSEEK_OCR_API_KEY', 'DEEPSEEK_OCR_MODEL'];
const lineFor = name => new RegExp('^[ \\t]*(?:export[ \\t]+)?' + name + '[ \\t]*=');
function valueOf(text, name) {
  const line = text.split(/\r?\n/).find(value => lineFor(name).test(value));
  if (!line) return '';
  return line.slice(line.indexOf('=') + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
}
async function readOptional(file) {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}
async function persist(directory, original, values) {
  const file = resolve(directory, '.dev.vars');
  if (await readOptional(file) !== original) throw new Error('Local configuration changed during OCR preparation. Retry without overwriting new settings.');
  const managed = Object.keys(values);
  const remaining = original.split(/\r?\n/).filter(line => !managed.some(name => lineFor(name).test(line))).join('\n').trimEnd();
  const next = (remaining ? remaining + '\n\n' : '') + managed.map(name => name + '=' + values[name]).join('\n') + '\n';
  if (next !== original) await writeFile(file, next, 'utf8');
}

/** OCR credentials are deliberately isolated from issuance-recognition keys. */
export async function prepareDeepseekOcr(directory, original, { env = process.env, fetchImpl = fetch } = {}) {
  const requested = env.OCR_AI_PROVIDER || valueOf(original, 'OCR_AI_PROVIDER');
  if (requested && !['deepseek', 'legacy'].includes(requested)) throw new Error('OCR_AI_PROVIDER must be deepseek or legacy.');
  if (requested === 'legacy') {
    if (env.OCR_AI_PROVIDER === 'legacy') await persist(directory, original, { OCR_AI_PROVIDER: 'legacy' });
    return { configured: true, provider: 'legacy' };
  }
  // Only OCR-specific variable names and OCR-specific files are permitted here.
  const privateConfig = await readOptional(resolve(directory, '.dev.vars.deepseek-ocr'));
  let key = env.DEEPSEEK_OCR_API_KEY || valueOf(privateConfig, 'DEEPSEEK_OCR_API_KEY') || valueOf(original, 'DEEPSEEK_OCR_API_KEY');
  if (!key && env.LOCALAPPDATA) {
    const shared = await readOptional(resolve(env.LOCALAPPDATA, 'BondCentreBeta', 'secrets', 'ocr-deepseek.env'));
    key = valueOf(shared, 'DEEPSEEK_OCR_API_KEY');
  }
  if (!key && !requested) return null;
  if (typeof key !== 'string' || !/^[A-Za-z0-9._~+/=-]{20,512}$/.test(key)) {
    throw new Error('OCR-only DeepSeek API key is missing or unsafe. Configure DEEPSEEK_OCR_API_KEY in the private .dev.vars.deepseek-ocr file.');
  }
  const model = env.DEEPSEEK_OCR_MODEL || valueOf(original, 'DEEPSEEK_OCR_MODEL') || 'deepseek-flash';
  if (model !== 'deepseek-flash') throw new Error('DEEPSEEK_OCR_MODEL must be deepseek-flash.');

  let response;
  try {
    response = await fetchImpl(modelsUrl, { method: 'GET', headers: { Authorization: 'Bearer ' + key }, redirect: 'error', signal: AbortSignal.timeout(5000) });
  } catch { throw new Error('OCR-only DeepSeek model-directory check could not connect. Existing configuration was retained.'); }
  if (!response.ok || response.redirected) {
    try { await response.body?.cancel(); } catch {}
    throw new Error(`OCR-only DeepSeek model-directory check returned HTTP ${response.status}; existing configuration was retained.`);
  }
  const payload = await readModelDirectory(response);
  if (!Array.isArray(payload?.data) || !payload.data.some(item => item?.id === model)) throw new Error('The OCR DeepSeek model is not available for this key. Existing configuration was retained.');
  // This controlled helper prepares the user's explicitly authorized OCR-only
  // migration. A separate OCR credential never grants access to issuance use.
  const processingApproved = ![env.AI_PROCESSING_APPROVED, valueOf(original, 'AI_PROCESSING_APPROVED')]
    .some(value => String(value ?? '').trim().toLowerCase() === 'false');
  await persist(directory, original, { [names[0]]: 'deepseek', [names[1]]: key, [names[2]]: model, AI_PROCESSING_APPROVED: String(processingApproved) });
  return { configured: true, provider: 'deepseek', model, healthy: true, processingApproved };
}

async function readModelDirectory(response) {
  const limit = 256000;
  if (Number(response.headers.get('Content-Length')) > limit) {
    try { await response.body?.cancel(); } catch {}
    throw new Error('OCR DeepSeek model-directory response exceeded the safe size limit.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('OCR DeepSeek model-directory response was invalid.');
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error('oversize'); }
      chunks.push(value);
    }
  } catch { throw new Error('OCR DeepSeek model-directory response was invalid or too large.'); }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error('OCR DeepSeek model-directory response was invalid.'); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--runtime')) throw new Error('Usage: node tools/prepare-deepseek-ocr.mjs [--runtime directory]');
  const directory = args[1] ? resolve(args[1]) : fileURLToPath(new URL('..', import.meta.url));
  if (!(await stat(directory)).isDirectory()) throw new Error('Local beta directory is missing.');
  const result = await prepareDeepseekOcr(directory, await readOptional(resolve(directory, '.dev.vars')));
  console.log(result?.provider === 'deepseek'
    ? `OCR-only DeepSeek configuration ready (${result.model})${result.processingApproved ? '' : '; processing remains disabled by explicit authorization settings'}. Credentials remain private.`
    : 'OCR keeps its existing provider; no issuance-recognition credential was used.');
}
