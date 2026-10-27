import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareDeepseekIssuance } from './prepare-deepseek-issuance.mjs';
import { prepareDeepseekOcr } from './prepare-deepseek-ocr.mjs';

const gateway = 'http://127.0.0.1:11435';
const names = ['ISSUANCE_LOCAL_AI_ENABLED', 'ISSUANCE_LOCAL_AI_URL', 'ISSUANCE_LOCAL_AI_TOKEN', 'ISSUANCE_LOCAL_AI_TIMEOUT_MS'];

export async function prepareLocalIssuanceAi(directory, { env = process.env, fetchImpl = fetch } = {}) {
  const issuance = await prepareIssuanceAi(directory, { env, fetchImpl });
  const original = await readFile(resolve(directory, '.dev.vars'), 'utf8');
  const ocr = await prepareDeepseekOcr(directory, original, { env, fetchImpl });
  return ocr ? { ...issuance, ocr } : issuance;
}

async function prepareIssuanceAi(directory, { env = process.env, fetchImpl = fetch } = {}) {
  if (!(await stat(directory)).isDirectory()) throw new Error('Local beta directory is missing.');
  const file = resolve(directory, '.dev.vars');
  let original = '';
  try { original = await readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const deepseek = await prepareDeepseekIssuance(directory, original, { env, fetchImpl });
  if (deepseek) return deepseek;
  const saved = original.match(/^\s*ISSUANCE_LOCAL_AI_TOKEN\s*=\s*(.*?)\s*$/m)?.[1]?.replace(/^(["'])(.*)\1$/, '$2');
  const token = env.LOCAL_ISSUANCE_AI_TOKEN || saved;
  if (typeof token !== 'string' || !/^[A-Za-z0-9._~+/=-]{32,512}$/.test(token)) {
    throw new Error('Local recognition credential is missing or unsafe: configure a 32-512 character hex/base64 token in LOCAL_ISSUANCE_AI_TOKEN.');
  }
  let healthy = false, healthFailure = '';
  try {
    const response = await fetchImpl(gateway + '/health', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) healthFailure = 'http_' + response.status;
    else {
      const health = await response.json();
      healthy = health.status === 'ok' && health.model === 'gpt-oss:20b' && health.promptRevision === 'local-20b-20260904-1';
      if (!healthy) healthFailure = 'incompatible';
    }
  } catch { healthFailure = 'unavailable'; }
  const selectLegacy = env.ISSUANCE_AI_PROVIDER === 'legacy';
  const managedNames = selectLegacy ? [...names, 'ISSUANCE_AI_PROVIDER'] : names;
  const remaining = original.split(/\r?\n/).filter(line => !managedNames.some(name => new RegExp('^[ \\t]*(?:export[ \\t]+)?' + name + '[ \\t]*=').test(line))).join('\n').trimEnd();
  const values = [names[0] + '=true', names[1] + '=' + gateway + '/v1/issuance-recognition', names[2] + '=' + token, names[3] + '=45000', ...(selectLegacy ? ['ISSUANCE_AI_PROVIDER=legacy'] : [])];
  const next = (remaining ? remaining + '\n\n' : '') + values.join('\n') + '\n';
  if (next !== original) await writeFile(file, next, 'utf8');
  return { configured: true, provider: 'legacy', gateway, model: 'gpt-oss:20b', healthy, ...(healthFailure ? { healthFailure } : {}) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--runtime')) throw new Error('Usage: node tools/prepare-local-issuance-ai.mjs [--runtime directory]');
  const directory = args[1] ? resolve(args[1]) : fileURLToPath(new URL('..', import.meta.url));
  const result = await prepareLocalIssuanceAi(directory);
  if (result.provider === 'deepseek') console.log(`DeepSeek result-recognition API ready (${result.model}). Credentials remain in the private .dev.vars file.`);
  else if (result.healthy) console.log(`Local result-recognition AI ready (${result.model}). Credentials remain in the private .dev.vars file.`);
  else console.warn(`Local result-recognition gateway is not ready (${result.healthFailure}); beta can start with its Cloudflare AI fallback.`);
  if (result.ocr?.provider === 'deepseek') console.log(`OCR-only DeepSeek API configured (${result.ocr.model})${result.ocr.processingApproved ? '' : '; processing remains disabled by explicit authorization settings'}. Its credential is separate from result recognition.`);
}
