// Preserve the provider of adapted fields without changing legacy DM-only results.
export function fieldProvider(row, fields = []) {
  const sources = fields.map(field => row?._fieldSources?.[field]).filter(Boolean);
  if (sources.length) {
    const qb = sources.some(source => source === 'QB' || source === 'DM+QB');
    const dm = sources.some(source => source === 'DM' || source === 'DM+QB');
    return qb ? dm ? 'DM+QB' : 'QB' : 'DM';
  }
  return row?._provider || (row?._qb ? 'QB' : 'DM');
}

export function rowProvenance(row, fields = []) {
  const provider = fieldProvider(row, fields);
  return provider === 'DM' ? {} : { provider, ...(row?._qb ? { providerInfo: row._qb } : {}) };
}
