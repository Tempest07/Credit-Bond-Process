import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const modelsUrl = 'https://api.deepseek.com/models';
const models = new Set(['deepseek-flash', 'deepseek-v4-pro']);
const names = ['ISSUANCE_AI_PROVIDER', 'DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL', 'ISSUANCE_DEEPSEEK_TIMEOUT_MS'];
const lineFor = name => new RegExp('^[ \\t]*(?:export[ \\t]+)?' + name + '[ \\t]*=');

function valueOf(text, name) {
  const line = text.split(/\r?\n/).find(value => lineFor(name).test(value));
  if (!line) return '';
  const value = line.slice(line.indexOf('=') + 1).trim();
  return value.replace(/^(["'])(.*)\1$/, '$2');
}

async function readOptional(file) {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}

/** Returns null when the existing local/Cloudflare path should remain selected. */
export async function prepareDeepseekIssuance(directory, original, { env = process.env, fetchImpl = fetch } = {}) {
  const requested = env.ISSUANCE_AI_PROVIDER || valueOf(original, 'ISSUANCE_AI_PROVIDER');
  if (requested && !['deepseek', 'legacy'].includes(requested)) throw new Error('ISSUANCE_AI_PROVIDER must be deepseek or legacy.');
  if (requested === 'legacy') return null;

  const privateConfig = await readOptional(resolve(directory, '.dev.vars.deepseek'));
  let key = env.DEEPSEEK_API_KEY || valueOf(privateConfig, 'DEEPSEEK_API_KEY') || valueOf(original, 'DEEPSEEK_API_KEY');
  if (!key && env.LOCALAPPDATA) {
    // Read only the issuance credential; new beta folders need no copied key.
    const shared = await readOptional(resolve(env.LOCALAPPDATA, 'BondCentreBeta', 'secrets', 'issuance-deepseek.env'));
    key = valueOf(shared, 'DEEPSEEK_API_KEY');
  }
  if (!key && !requested) return null;
  if (typeof key !== 'string' || !/^[A-Za-z0-9._~+/=-]{20,512}$/.test(key)) {
    throw new Error('DeepSeek API key is missing or unsafe. Save the official key in the private .dev.vars.deepseek file or DEEPSEEK_API_KEY environment variable.');
  }
  const model = env.DEEPSEEK_MODEL || valueOf(original, 'DEEPSEEK_MODEL') || 'deepseek-flash';
  if (!models.has(model)) throw new Error('DEEPSEEK_MODEL must be deepseek-flash or deepseek-v4-pro.');
  const timeoutMs = Number(env.ISSUANCE_DEEPSEEK_TIMEOUT_MS || valueOf(original, 'ISSUANCE_DEEPSEEK_TIMEOUT_MS') || 45000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5000 || timeoutMs > 90000) throw new Error('ISSUANCE_DEEPSEEK_TIMEOUT_MS must be 5000-90000.');

  let response;
  try {
    response = await fetchImpl(modelsUrl, { method: 'GET', headers: { Authorization: 'Bearer ' + key }, redirect: 'error', signal: AbortSignal.timeout(5000) });
  } catch { throw new Error('DeepSeek model-directory check could not connect to the official API. Existing configuration was retained.'); }
  if (!response.ok || response.redirected) {
    try { await response.body?.cancel(); } catch {}
    throw new Error(`DeepSeek model-directory check returned HTTP ${response.status}; existing configuration was retained.`);
  }
  const payload = await readModelDirectory(response);
  if (!Array.isArray(payload?.data) || !payload.data.some(item => item?.id === model)) {
    throw new Error('The selected DeepSeek model is not available for this API key. Existing configuration was retained.');
  }

  const file = resolve(directory, '.dev.vars');
  if (await readOptional(file) !== original) throw new Error('Local configuration changed during preparation. Retry without overwriting the new settings.');
  const remaining = original.split(/\r?\n/).filter(line => !names.some(name => lineFor(name).test(line))).join('\n').trimEnd();
  const values = ['ISSUANCE_AI_PROVIDER=deepseek', 'DEEPSEEK_API_KEY=' + key, 'DEEPSEEK_MODEL=' + model, 'ISSUANCE_DEEPSEEK_TIMEOUT_MS=' + timeoutMs];
  const next = (remaining ? remaining + '\n\n' : '') + values.join('\n') + '\n';
  if (next !== original) await writeFile(file, next, 'utf8');
  return { configured: true, provider: 'deepseek', model, healthy: true };
}

async function readModelDirectory(response) {
  const limit = 256000;
  if (Number(response.headers.get('Content-Length')) > limit) {
    await response.body?.cancel();
    throw new Error('DeepSeek model-directory response exceeded the safe size limit. Existing configuration was retained.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('DeepSeek model-directory response was invalid. Existing configuration was retained.');
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error('oversize');
      }
      chunks.push(value);
    }
  } catch { throw new Error('DeepSeek model-directory response was invalid or too large. Existing configuration was retained.'); }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error('DeepSeek model-directory response was invalid. Existing configuration was retained.'); }
}
