const PROVIDERS = new Set(['DM', 'QB', 'DM+QB']);

export function dataProviderLabel(value, fallback = 'DM') {
  if (Array.isArray(value)) {
    const sources = new Set(value.map(item => dataProviderLabel(item, fallback)).filter(Boolean));
    return sources.has('DM+QB') || sources.has('DM') && sources.has('QB') ? 'DM+QB' : sources.has('QB') ? 'QB' : fallback;
  }
  const source = typeof value === 'string' ? value : value?.provider || value?.source;
  const label = String(source || '').toUpperCase();
  if (PROVIDERS.has(label)) return label;
  const used = value?.dataSources?.used;
  if (Array.isArray(used) && used.includes('QB')) return used.includes('DM') ? 'DM+QB' : 'QB';
  return fallback;
}

export function isMarketDataSource(source) {
  return ['dm', 'qb', 'dm+qb'].includes(String(source || '').toLowerCase());
}

export function marketDataProvenance(value) {
  const provider = dataProviderLabel(value, '');
  if (!provider) return {};
  const input = value?.providerInfo;
  return { provider, ...(input && typeof input === 'object' && !Array.isArray(input) ? {
    providerInfo: {
      apiNames: Array.isArray(input.apiNames) ? input.apiNames.filter(name => typeof name === 'string').slice(0, 20) : [],
      date: typeof input.date === 'string' ? input.date : '',
      fetchedAt: typeof input.fetchedAt === 'string' ? input.fetchedAt : '',
    },
  } : {}) };
}
