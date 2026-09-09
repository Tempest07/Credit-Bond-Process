import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createValuationService } from './local-valuation-service.mjs';
import { ValuationStore } from './valuation-store.mjs';
import { DEFAULT_VALUATION_MODEL } from './local-valuation-model.mjs';

// Identity is supplied only by the authenticated Pages proxy, never the browser.
export function createValuationGatewayHandler({ directory = fileURLToPath(new URL('../.local-data/valuation-users/', import.meta.url)) } = {}) {
  const services = new Map();
  return async (envelope, signal) => {
    const { userId, action, method, body = {} } = envelope || {};
    if (typeof userId !== 'string' || !userId || userId.length > 200) throw new Error('Invalid identity');
    if (!(method === 'GET' && /^(status|history|runs\/[a-f0-9-]+)$/.test(action)) && !(method === 'POST' && /^(analyze|feedback|experience)$/.test(action))) throw new Error('Invalid action');
    const key = createHash('sha256').update(userId).digest('hex');
    if (!services.has(key)) services.set(key, createValuationService({
      env: {}, store: new ValuationStore(join(directory, `${key}.json`)),
      resolveEvidence: async body => {
        const e = body.evidence;
        if (!e || e.sample !== false || !Array.isArray(e.targets) || !Array.isArray(e.candidates) || !e.target || e.candidates.length > 60) throw new Error('Invalid evidence');
        return e;
      },
    }));
    const result = await services.get(key)(`/bond-centre/api/valuation/${action}`, method, { ...body, model: DEFAULT_VALUATION_MODEL }, signal);
    if (action === 'status') {
      result.models = result.models.filter(m => m.name === DEFAULT_VALUATION_MODEL);
      result.defaultModel = DEFAULT_VALUATION_MODEL;
    }
    return result;
  };
}
