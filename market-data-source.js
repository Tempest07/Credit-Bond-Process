const PROVIDERS = new Set(['DM', 'QB', 'DM+QB']);

/** The selected route for a future request, separate from a result's provenance. */
export function dataSourceModeLabel(mode) {
  switch (mode) {
    case 'dm': return 'DM';
    case 'qb': return 'QB';
    case 'auto': return '自动';
    default: return '数据源';
  }
}

/** Only explicit static copy participates; live status and saved sources stay intact. */
export function renderDataSourceLabels(document, mode) {
  const source = dataSourceModeLabel(mode);
  for (const node of document?.querySelectorAll?.('[data-source-template]') || []) {
    const template = node.dataset?.sourceTemplate;
    if (typeof template === 'string') node.textContent = template.replaceAll('{source}', source);
  }
}

export function dataProviderLabel(value, fallback = 'DM') {
  if (Array.isArray(value)) {
    const sources = new Set(value.map(item => dataProviderLabel(item, fallback)).filter(Boolean));
    return sources.has('DM+QB') || sources.has('DM') && sources.has('QB') ? 'DM+QB' : sources.has('QB') ? 'QB' : sources.has('DM') ? 'DM' : fallback;
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
