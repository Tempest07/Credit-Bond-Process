import { BOND_TYPES, quoteRows, filterQuotes, quoteOutput } from './bond-list-filter.js?v=20261026release5361';
import { compareQuoteToValuation, quoteWarningEmphasis, LOW_QUOTE_WARNING_BP } from './bond-list-comparison.js?v=20261026release5361';
import { dataProviderLabel } from './market-data-source.js?v=20261026release5361';
import { couponMetadataComplete, couponMetadataUsable, supplementCouponMetadata } from './bond-list-metadata.js?v=20261026release5361';

const codePattern = /^\d{6,12}\.(?:IB|SH|SZ|BJ)$/i;
const couponFormatter = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 6, useGrouping: false });
const spreadFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2, useGrouping: false });

export function initializeBondList({ onToast, onAccessChange, getDataSourceMode = () => 'auto' } = {}) {
  const root = document.querySelector('.view[data-view="bond-list"]');
  if (!root) return { setActive: async () => {}, flushSave: async () => true, hasPendingChanges: () => false, hasAccess: () => false, clearAccess: () => {}, resume: () => {}, resetDataSource: () => {} };
  const $ = id => root.querySelector('#bondList-' + id);
  const apiRoot = new URL('./api/bond-list/', location.href).pathname;
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
  const savedLabel = local ? '本地已保存' : '云端已保存';
  let sections = [], revision = 0, editVersion = 0;
  let active = false, loaded = false, loading = null, dirty = false, conflict = false, flushing = false;
  let saveTimer, lookupTimer, savePromise = null, lookupPromise = null, lookupAbort = null;
  let lookupGeneration = 0;
  let backupKey, recoveryKey, archived = [], busy = false;
  let access = false, accessVersion = 0, retryMode = '', metadataUserId = '';
  const zeroCouponConfirmations = new Set();
  const failedNames = new Set();
  let lookupResults = {};
  const couponResults = new Map();
  const valuationResults = new Map();
  const couponAttempted = new Map(), valuationAttempted = new Map();
  let couponTimer, couponAbort = null, couponPromise = null, couponGeneration = 0;
  let couponPending = new Set();
  let valuationPending = new Set();
  let metadataLimitNotice = '';
  const typeInputs = new Map();
  const filters = { types: [], side: 'all', couponOp: 'any', couponMin: '', couponMax: '', missing: 'all' };
  let selectedText = 'OFR/BID', selectedCount = 0, filterActive = false, mode = 'results';

  const requestMode = () => {
    const value = getDataSourceMode();
    return ['dm', 'qb'].includes(value) ? value : 'auto';
  };
  const rateLimitMessage = error => {
    return '查询过于频繁，请稍后重试。' + (error.retryAfter ? '建议至少等待 ' + error.retryAfter + ' 秒后手动刷新。' : '');
  };

  function setAccess(value) {
    if (access === value) return;
    access = value;
    onAccessChange?.();
  }

  function notify(message, error = false) {
    $('notice').textContent = message;
    $('notice').hidden = !message;
    $('notice').classList.toggle('error', error);
  }
  function clearMetadataLimitNotice() {
    if (metadataLimitNotice && $('notice').textContent === metadataLimitNotice) notify('');
    metadataLimitNotice = '';
  }
  function retryState(mode = '') {
    retryMode = mode;
    $('retry').hidden = !mode;
    $('retry').disabled = mode === 'conflict';
    $('retry').textContent = mode === 'load' ? '重新读取' : mode === 'conflict' ? '请导出后刷新' : '重试保存';
  }
  async function api(path, body, signal) {
    const requestAccessVersion = accessVersion;
    const response = await fetch(apiRoot + path, body === undefined ? { signal } : {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'X-Bond-List': '1' },
      body: JSON.stringify(body)
    });
    if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
    if (response.status === 401) {
      accessVersion++;
      setAccess(false);
      stopCoupons(true);
      renderResults();
      $('login-link').hidden = false;
      const error = new Error('请重新登录；未保存的输入可先导出草稿。');
      error.status = 401;
      throw error;
    }
    const result = await response.json();
    if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
    if (!response.ok) {
      const error = new Error(result.error || '请求失败');
      error.status = response.status;
      error.code = result.code;
      const seconds = Number(result.retryAfter ?? response.headers.get('Retry-After'));
      if (Number.isFinite(seconds) && seconds > 0 && seconds <= 86400) error.retryAfter = Math.ceil(seconds);
      throw error;
    }
    if (requestAccessVersion === accessVersion) {
      if (result && typeof result === 'object' && !Array.isArray(result)) setAccess(true);
      $('login-link').hidden = true;
    }
    return result;
  }
  function lineInfo(line) {
    const raw = line.trim();
    if (!raw) return null;
    const fields = raw.split(/[，,]/);
    if (codePattern.test(fields[0].trim())) return { coded: true, code: fields[0].trim().toUpperCase(), name: fields[1]?.trim() || fields[0].trim() };
    return { name: fields[0].trim(), ready: fields.length > 1 && fields.slice(1).join(',').trim().length > 0 };
  }
  function pendingNames() {
    return [...new Set(sections.flatMap(section => section.text.split('\n').map(lineInfo)
      .filter(line => line && !line.coded && line.ready).map(line => line.name)))];
  }
  function couponCodes() {
    return [...new Set(sections.flatMap(section => section.text.split('\n').map(lineInfo)
      .filter(line => line?.coded).map(line => line.code)))];
  }
  function renderResults() {
    const all = quoteRows(sections, couponResults, (code, result) => zeroCouponConfirmations.has(zeroCouponKey(code, result)));
    const result = filterQuotes(all, filters);
    selectedText = quoteOutput(result.rows); selectedCount = result.rows.length; filterActive = result.active;
    const pending = all.filter(row => row.code && (!couponResults.has(row.code) || couponPending.has(row.code) || couponResults.get(row.code)?.status === 'loading')).length;
    const missingCoupon = all.filter(row => couponResults.get(row.code)?.status === 'missing').length;
    const unconfirmedZero = all.filter(row => row.couponNeedsConfirmation).length;
    const missingType = all.filter(row => couponResults.get(row.code)?.status === 'matched' && row.bondType === '未知').length;
    const unknownSide = all.filter(row => row.direction === 'unknown').length;
    const failed = all.filter(row => [couponResults.get(row.code), valuationResults.get(row.code)]
      .some(value => value?.status === 'error' && value.reason !== 'rate_limit_skipped')).length;
    const incomplete = all.filter(row => [couponResults.get(row.code), valuationResults.get(row.code)]
      .some(value => value?.reason === 'rate_limit_skipped')).length;
    const valuationWaiting = all.filter(row => row.code && (!valuationResults.has(row.code) || valuationPending.has(row.code) || valuationResults.get(row.code)?.status === 'loading')).length;
    const valuationMissing = all.filter(row => valuationResults.get(row.code)?.status === 'missing').length;
    const valuationAccessDenied = all.some(row => valuationResults.get(row.code)?.reason === 'dm_valuation_access_denied');
    const retained = all.filter(row => couponResults.get(row.code)?.refreshFailed || valuationResults.get(row.code)?.refreshFailed).length;
    const needsMetadata = filters.types.length > 0 || filters.couponOp !== 'any' || ['coupon', 'type'].includes(filters.missing);
    const waiting = needsMetadata && pending > 0 && active && access && !flushing;
    const unresolved = result.rows.filter(row => !row.code).length;
    const branches = new Set(result.rows.map(row => row.sectionIndex)).size;
    const comparisons = result.rows.map(quote => compareQuoteToValuation(quote, valuationResults.get(quote.code)));
    const warnings = comparisons.filter(comparison => comparison.warning).length;
    const close = comparisons.filter(comparison => comparison.couponNear).length;
    $('results-counts').textContent = '符合 ' + selectedCount + ' / 共 ' + all.length + ' 条报价 · ' + branches + ' 个分行'
      + (warnings ? ' · ' + warnings + ' 条报价提示' : '') + (close ? ' · ' + close + ' 条票面接近估值' : '');
    $('metadata-status').textContent = pending && access ? pending + ' 条资料读取中'
      : [unconfirmedZero ? unconfirmedZero + ' 条票面为 0，待人工确认' : '', retained ? retained + ' 条刷新未完成，保留上次资料' : '', failed ? failed + ' 条查询失败' : '', incomplete ? incomplete + ' 条未完成' : '', missingCoupon ? '票面缺失 ' + missingCoupon : '', missingType ? '品种未知 ' + missingType : '', unknownSide ? '方向未识别 ' + unknownSide : '', valuationAccessDenied ? '估值接口权限待核对' : valuationWaiting && access ? '估值读取中 ' + valuationWaiting : valuationMissing ? '估值缺失 ' + valuationMissing : ''].filter(Boolean).join(' · ');
    $('filter-error').textContent = result.error; $('filter-error').hidden = !result.error;
    $('results-body').replaceChildren();
    for (const quote of result.rows) {
      const row = document.createElement('tr'); row.dataset.sectionIndex = String(quote.sectionIndex); row.dataset.lineIndex = String(quote.lineIndex);
      const valuation = valuationResults.get(quote.code);
      const comparison = compareQuoteToValuation(quote, valuation);
      row.classList.toggle('bond-list-quote-warning', Boolean(comparison.warning));
      const emphasis = quoteWarningEmphasis(comparison.warning);
      if (emphasis) {
        row.dataset.valuationTone = emphasis.tone;
        row.style.setProperty('--quote-color-progress', `${emphasis.strength * 100}%`);
        row.style.setProperty('--quote-row-weight', `${4 + emphasis.strength * 14}%`);
        row.style.setProperty('--quote-badge-weight', `${10 + emphasis.strength * 25}%`);
      }
      const cell = label => { const element = document.createElement('td'); element.setAttribute('data-label', label); row.append(element); return element; };
      const bond = cell('债券／代码');
      const name = document.createElement('span'); name.className = 'bond-list-result-name'; name.textContent = quote.name; bond.append(name);
      const code = document.createElement('span'); code.className = 'bond-list-result-code'; code.textContent = quote.code || '待补代码'; bond.append(code);
      const type = cell('品种');
      const description = document.createElement('span'); description.textContent = quote.bondType;
      description.title = couponResults.get(quote.code)?.typeDescription || ''; type.append(description);
      for (const attribute of quote.attributes) {
        const tag = document.createElement('span'); tag.className = 'bond-list-result-attribute'; tag.textContent = attribute; type.append(tag);
      }
      const rate = document.createElement('span'); rate.className = 'bond-list-coupon-value';
      const metadata = couponResults.get(quote.code);
      if (quote.couponRate !== null || quote.couponNeedsConfirmation) {
        rate.textContent = couponFormatter.format(metadata.couponRate) + '%' + (quote.couponNeedsConfirmation ? '（待确认）' : '');
        const couponSource = dataProviderLabel(metadata?.fieldSources?.couponRate || metadata);
        const couponFetchedAt = metadata?.fieldFetchedAt?.couponRate || metadata?.fetchedAt;
        rate.title = [metadata?.rateType, couponFetchedAt ? couponSource + ' 查询于 ' + new Date(couponFetchedAt).toLocaleString('zh-CN') : couponSource + ' 最新票面利率'].filter(Boolean).join(' · ');
        if (metadata?.refreshFailed) rate.title += ' · 刷新未完成，保留上次资料';
        if (quote.couponRate === 0) rate.title += ' · 已人工确认0%票面（仅本页有效）';
        if (/浮动|浮息/.test(metadata?.rateType || '')) {
          const floating = document.createElement('span'); floating.className = 'bond-list-result-attribute bond-list-coupon-type'; floating.textContent = '浮动'; type.append(floating);
        }
      } else {
        rate.className += ' unavailable';
        rate.textContent = !quote.code ? '待补代码' : metadata?.reason === 'rate_limit_skipped' ? '未完成' : metadata?.status === 'error' ? '查询失败' : metadata?.status === 'loading' ? '查询中…' : metadata ? '未返回' : !access ? '请登录' : couponPending.has(quote.code) ? '查询中…' : '待查询';
      }
      const couponCell = cell('票面利率'); couponCell.append(rate);
      if (quote.couponNeedsConfirmation) {
        const confirm = document.createElement('button');
        confirm.type = 'button'; confirm.className = 'button subtle bond-list-zero-confirm';
        confirm.textContent = '确认0%票面';
        confirm.setAttribute('aria-label', `确认${quote.name}（${quote.code}）的0%票面`);
        const key = zeroCouponKey(quote.code, metadata);
        confirm.addEventListener('click', () => {
          const current = couponResults.get(quote.code);
          if (!active || !access || current?.couponRate !== 0 || zeroCouponKey(quote.code, current) !== key) return;
          zeroCouponConfirmations.add(key);
          renderResults();
        });
        couponCell.append(confirm);
      }
      if (comparison.couponNear) {
        const near = document.createElement('span'); near.className = 'bond-list-comparison-badge near'; near.textContent = '≈ 估值';
        near.title = `票面与${valuation.institution}估值相差 ${comparison.couponGapBp >= 0 ? '+' : ''}${spreadFormatter.format(comparison.couponGapBp)}bp；接近范围为 ±5bp`;
        couponCell.append(near);
      }
      const valuationCell = cell('参考估值');
      const valuationRate = document.createElement('span'); valuationRate.className = 'bond-list-valuation-value';
      if (valuation?.status === 'matched') {
        valuationRate.textContent = couponFormatter.format(valuation.yield) + '%';
        valuationRate.title = `${valuation.institution}估值 · ${valuation.date} · ${valuation.basis}收益率${valuation.basisFallback ? '（行权估值缺失，回退到期）' : ''}`;
        valuationCell.append(valuationRate);
        const source = document.createElement('span'); source.className = 'bond-list-valuation-meta';
        source.textContent = `${dataProviderLabel(valuation) === 'DM' ? '' : dataProviderLabel(valuation) + ' / '}${valuation.institution} · ${valuation.basis}${valuation.basisFallback ? '（回退）' : ''} · ${valuation.date.slice(5)}`;
        source.title = `${valuation.date} · ${dataProviderLabel(valuation)} 查询于 ${new Date(valuation.fetchedAt).toLocaleString('zh-CN')}`;
        if (valuation.refreshFailed) source.title += ' · 刷新未完成，保留上次资料';
        valuationCell.append(source);
        if (comparison.parsedQuote?.kind === 'netPrice' && Number.isFinite(valuation.netPrice)) {
          const price = document.createElement('span'); price.className = 'bond-list-valuation-meta';
          price.textContent = '净价 ' + couponFormatter.format(valuation.netPrice); valuationCell.append(price);
        }
      } else {
        valuationRate.className += ' unavailable';
        valuationRate.textContent = !quote.code ? '待补代码' : !access ? '请登录' : valuation?.reason === 'dm_valuation_access_denied' ? '权限待核对' : valuation?.reason === 'rate_limit_skipped' ? '未完成' : valuation?.status === 'error' ? '查询失败' : valuation?.status === 'loading' ? '查询中…' : valuation ? '未返回' : valuationPending.has(quote.code) ? '查询中…' : '待查询';
        if (valuation?.reason === 'dm_valuation_access_denied') valuationRate.title = 'DM 当前个券估值请求被拒绝（GW-000-4006）；需核对该应用的接口授权或调用配置，不能据此判断估值服务未开通。';
        valuationCell.append(valuationRate);
      }
      const direction = document.createElement('span'); direction.className = 'bond-list-direction ' + quote.direction;
      direction.textContent = { ofr: 'OFR', bid: 'BID', both: 'OFR / BID', unknown: '待确认' }[quote.direction];
      cell('方向').append(direction);
      const quoteCell = cell('原始报价'); quoteCell.textContent = quote.quote;
      if (comparison.warning) {
        const warning = document.createElement('span'); warning.className = 'bond-list-comparison-badge warning';
        const gap = comparison.warning.gap;
        const below = comparison.warning.kind === 'yield' && gap < 0;
        warning.textContent = comparison.warning.kind === 'netPrice'
          ? '净价低于估值 ' + couponFormatter.format(gap) + '元'
          : (below ? '低于估值 ' : '高于估值 +') + spreadFormatter.format(gap * 100) + 'bp';
        warning.title = comparison.warning.kind === 'netPrice'
          ? `报价净价低于${valuation.institution}${valuation.basis}估值净价 ${valuation.netPrice}（${valuation.date}）`
          : `报价收益率${below ? '低于' : '高于'}${valuation.institution}${valuation.basis}估值收益率 ${valuation.yield}%（${valuation.date}）${below ? `；低于 ${LOW_QUOTE_WARNING_BP}bp 起提示` : ''}`;
        quoteCell.append(warning);
      }
      cell('分行').textContent = quote.branch;
      $('results-body').append(row);
    }
    $('results-empty').hidden = selectedCount > 0;
    $('results-empty').textContent = result.error ? '请调整筛选条件' : all.length ? '暂无符合条件的报价' : '暂无报价';
    $('preview').textContent = selectedText; $('result-preview').textContent = selectedText;
    const hint = result.error || (waiting ? '债券资料读取中，完成后可复制筛选结果'
      : unresolved ? unresolved + ' 条待补码或补全 · 处理后可复制发送版'
      : selectedCount ? selectedCount + ' 条报价 · ' + branches + ' 个分行 · 可直接粘贴发送' : '暂无可发送的报价');
    $('copy-hint').textContent = hint; $('result-copy-hint').textContent = hint;
    $('copy').textContent = filterActive ? '复制筛选结果（' + selectedCount + ' 条）' : '复制发送版';
    $('copy').disabled = !loaded || Boolean(loading) || !selectedCount || unresolved > 0 || Boolean(result.error) || busy || waiting;
    $('coupons-refresh').disabled = !active || !loaded || Boolean(loading) || flushing || Boolean(couponPromise) || !couponCodes().length;
    $('coupons-refresh').textContent = couponPromise ? '资料读取中…' : '刷新债券资料';
    if (active && loaded && !loading && mode === 'editor') fitEditors();
  }
  function stopCoupons(clearCache = false) {
    clearTimeout(couponTimer);
    couponGeneration++;
    couponAbort?.abort(); couponAbort = null; couponPromise = null; couponPending = new Set(); valuationPending = new Set();
    if (clearCache) {
      couponResults.clear(); valuationResults.clear();
      couponAttempted.clear(); valuationAttempted.clear();
    }
  }
  function resetMetadataAttempts() {
    couponAttempted.clear(); valuationAttempted.clear();
  }
  function zeroCouponKey(code, result) {
    return JSON.stringify([metadataUserId, requestMode(), code,
      result.fieldSources?.couponRate || result.provider,
      result.fieldFetchedAt?.couponRate || result.fetchedAt]);
  }
  function chinaDay(value = Date.now()) {
    const at = typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(at) ? new Date(at + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) : '';
  }
  function needsMetadata(path, code) {
    const cache = path === 'coupons' ? couponResults : valuationResults;
    const attempted = path === 'coupons' ? couponAttempted : valuationAttempted;
    if (attempted.get(code) === chinaDay()) return false;
    const result = cache.get(code);
    if ((result?.refreshFailed || ['rate_limited', 'rate_limit_skipped'].includes(result?.reason))
      && Date.parse(result.nextCheckAt) > Date.now()) return false;
    const successful = result?.status === 'matched' && !result.refreshFailed
      && result.requestMode === requestMode()
      && (path === 'coupons' ? couponMetadataComplete(result, zeroCouponConfirmations.has(zeroCouponKey(code, result))) : Number.isFinite(result.yield));
    return !successful || (path === 'valuations'
      && chinaDay(result.checkedAt || result.fetchedAt) !== chinaDay());
  }
  function scheduleCoupons() {
    clearTimeout(couponTimer);
    if (active && access && loaded && !loading && !flushing && !couponPromise && !root.querySelector('[data-composing]')
      && couponCodes().some(code => needsMetadata('coupons', code) || needsMetadata('valuations', code))) {
      couponTimer = setTimeout(() => { void fetchCoupons(); }, 350);
    }
  }
  function fetchCoupons(refresh = false) {
    if (!active || !access || !loaded || loading || flushing || couponPromise || root.querySelector('[data-composing]')) return Promise.resolve();
    clearTimeout(couponTimer);
    if (refresh) resetMetadataAttempts();
    const codes = couponCodes().filter(code => needsMetadata('coupons', code) || needsMetadata('valuations', code));
    if (!codes.length) return Promise.resolve();
    if (refresh) clearMetadataLimitNotice();
    const generation = couponGeneration, controller = new AbortController(), selectedMode = requestMode();
    let rateLimitError = null;
    couponAbort = controller;
    couponPending = new Set(codes.filter(code => needsMetadata('coupons', code)));
    valuationPending = new Set(codes.filter(code => needsMetadata('valuations', code)));
    couponPending.forEach(code => couponAttempted.set(code, chinaDay()));
    valuationPending.forEach(code => valuationAttempted.set(code, chinaDay()));
    couponPromise = (async () => {
      try {
        for (let start = 0; start < codes.length; start += 20) {
          const batch = codes.slice(start, start + 20);
          await Promise.allSettled([
            fetchMetadata('coupons', batch.filter(code => couponPending.has(code)), couponResults, couponPending),
            fetchMetadata('valuations', batch.filter(code => valuationPending.has(code)), valuationResults, valuationPending),
          ]);
          if (!active || controller.signal.aborted || generation !== couponGeneration) return;
          if (rateLimitError) {
            for (const code of codes.slice(start + 20)) {
              if (couponPending.has(code)) failMetadata(couponResults, code, 'rate_limit_skipped');
              if (valuationPending.has(code)) failMetadata(valuationResults, code, 'rate_limit_skipped');
            }
            metadataLimitNotice = rateLimitMessage(rateLimitError, selectedMode);
            notify(metadataLimitNotice, true);
            return;
          }
        }
      } catch {
        if (!controller.signal.aborted && generation === couponGeneration) {
          for (const code of codes) if (!couponResults.has(code)) couponResults.set(code, { status: 'error', requestMode: selectedMode });
        }
      } finally {
        if (generation === couponGeneration) {
          couponAbort = null; couponPromise = null; couponPending.clear(); valuationPending.clear();
          renderResults(); scheduleCoupons();
        }
      }
    })();
    renderResults();
    return couponPromise;

    async function fetchMetadata(path, batch, cache, pending) {
      if (!batch.length) return;
      try {
        const response = await api(path, { codes: batch }, controller.signal);
        if (!active || controller.signal.aborted || generation !== couponGeneration) return;
        if (response.rateLimited) {
          const seconds = Number(response.retryAfter);
          rateLimitError ||= { retryAfter: Number.isFinite(seconds) && seconds > 0 && seconds <= 86400 ? Math.ceil(seconds) : undefined };
        }
        for (const code of batch) {
          let result = response.results?.[code];
          const previous = cache.get(code);
          if (path === 'coupons' && couponMetadataUsable(previous) && previous.requestMode === selectedMode && result) {
            const incoming = { ...result, provider: result.provider || response.source,
              fetchedAt: result.fetchedAt || response.fetchedAt || new Date().toISOString() };
            result = { ...supplementCouponMetadata(previous, incoming) };
            for (const key of ['checkedAt', 'nextCheckAt', 'refreshStatus', 'refreshFailed', 'cached', 'reason', 'retryAfter']) {
              if (Object.hasOwn(incoming, key)) result[key] = incoming[key];
              else delete result[key];
            }
          }
          if ((previous?.status === 'matched' || path === 'coupons' && couponMetadataUsable(previous))
            && !(path === 'coupons' ? couponMetadataUsable(result) : result?.status === 'matched')) {
            cache.set(code, { ...previous, refreshFailed: true, requestMode: selectedMode,
              ...(result?.reason && previous.status === 'matched' ? { reason: result.reason } : {}),
              ...(result?.nextCheckAt ? { nextCheckAt: result.nextCheckAt } : {}) }); continue;
          }
          cache.set(code, result && ['matched', 'missing', 'loading', 'error'].includes(result.status)
            ? { ...result, provider: result.provider || response.source,
              fetchedAt: result.fetchedAt || response.fetchedAt || new Date().toISOString(), requestMode: selectedMode }
            : { status: 'error', requestMode: selectedMode });
        }
      } catch (error) {
        if (controller.signal.aborted || generation !== couponGeneration) return;
        if (error.status === 429) rateLimitError ||= error;
        const reason = error.status === 429 ? 'rate_limited'
          : path === 'valuations' && error.code === 'dm_valuation_access_denied' ? error.code : undefined;
        for (const code of batch) failMetadata(cache, code, reason);
      }
      if (controller.signal.aborted || generation !== couponGeneration) return;
      batch.forEach(code => {
        pending.delete(code);
        (path === 'coupons' ? couponAttempted : valuationAttempted).set(code, chinaDay());
      });
      renderResults();
    }
    function failMetadata(cache, code, reason) {
      const previous = cache.get(code);
      (cache === couponResults ? couponAttempted : valuationAttempted).set(code, chinaDay());
      const retrySeconds = Number(rateLimitError?.retryAfter);
      const nextCheckAt = ['rate_limited', 'rate_limit_skipped'].includes(reason)
        ? new Date(Date.now() + (Number.isFinite(retrySeconds) && retrySeconds > 0 ? retrySeconds : 60) * 1000).toISOString() : '';
      const partial = cache === couponResults && couponMetadataUsable(previous) && previous.status === 'missing';
      cache.set(code, previous?.status === 'matched' || partial ? { ...previous, refreshFailed: true, requestMode: selectedMode }
        : { status: 'error', requestMode: selectedMode, ...(reason ? { reason } : {}) });
      if (reason && !partial) Object.assign(cache.get(code), { reason });
      if (nextCheckAt) cache.get(code).nextCheckAt = nextCheckAt;
    }
  }
  function output(includeEmpty = false) {
    return 'OFR/BID' + sections.filter(section => includeEmpty || section.text.trim())
      .map(section => '\n\n' + section.title + '\n' + section.text.trim()).join('');
  }
  function backup() {
    if (!backupKey) return;
    try { localStorage.setItem(backupKey, JSON.stringify({ revision, sections })); }
    catch { notify('浏览器备份不可用，请留意上方保存状态，或导出草稿留存。', true); }
  }
  function changed() {
    editVersion++;
    dirty = true;
    backup();
    $('save-state').textContent = conflict ? '保存冲突 · 请导出草稿' : '正在保存…';
    clearTimeout(saveTimer);
    if (!conflict) saveTimer = setTimeout(() => { void save(); }, 450);
    renderSummary();
    scheduleLookup();
    scheduleCoupons();
  }
  function save() {
    if (savePromise) return savePromise;
    if (!dirty) return Promise.resolve(true);
    if (!loaded || conflict) return Promise.resolve(false);
    clearTimeout(saveTimer);
    savePromise = (async () => {
      while (dirty && !conflict) {
        const snapshot = JSON.stringify(sections);
        try {
          const result = await api('state', { revision, sections: JSON.parse(snapshot) });
          revision = result.revision;
          dirty = JSON.stringify(sections) !== snapshot;
          if (dirty) backup();
          else { try { localStorage.removeItem(backupKey); } catch {} }
          $('save-state').textContent = dirty ? '正在保存…' : savedLabel;
          $('save-dot').style.color = 'var(--success, #628a66)';
          if (!$('retry').hidden) notify('');
          retryState();
        } catch (error) {
          conflict = error.status === 409;
          backup();
          $('save-state').textContent = conflict ? '保存冲突 · 请导出草稿' : '尚未保存 · 请重试或导出';
          $('save-dot').style.color = 'var(--warning, #b57735)';
          retryState(conflict ? 'conflict' : 'save');
          notify(error.message, true);
          return false;
        }
      }
      return !dirty;
    })().finally(() => {
      if (!dirty || conflict || $('save-state').textContent !== '正在保存…') clearTimeout(saveTimer);
      savePromise = null;
    });
    return savePromise;
  }
  function fit(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.max(62, textarea.scrollHeight + 2) + 'px';
  }
  function fitEditors() {
    sections.forEach((_, index) => { if (!$('branch-' + index).hidden) fit($('text-' + index)); });
  }
  function renderEditors() {
    $('branches').replaceChildren();
    sections.forEach((section, index) => {
      const card = document.createElement('div');
      card.className = 'bond-list-branch'; card.id = 'bondList-branch-' + index;
      const top = document.createElement('div'); top.className = 'bond-list-branch-top';
      const title = document.createElement('h3'); title.textContent = section.title;
      const count = document.createElement('span'); count.className = 'bond-list-branch-count';
      top.append(title, count);
      const textarea = document.createElement('textarea');
      textarea.id = 'bondList-text-' + index;
      textarea.setAttribute('aria-label', section.title + '报价');
      textarea.placeholder = '输入债券简称，报价…'; textarea.value = section.text; textarea.spellcheck = false;
      textarea.addEventListener('input', () => { section.text = textarea.value; fit(textarea); changed(); });
      textarea.addEventListener('compositionstart', () => { textarea.dataset.composing = '1'; clearTimeout(lookupTimer); clearTimeout(couponTimer); });
      textarea.addEventListener('compositionend', () => { delete textarea.dataset.composing; scheduleLookup(); scheduleCoupons(); });
      const issue = document.createElement('div'); issue.className = 'bond-list-issue'; issue.setAttribute('aria-live', 'polite');
      card.append(top, textarea, issue); $('branches').append(card); fit(textarea);
    });
  }
  function renderSummary() {
    let total = 0, populated = 0;
    sections.forEach((section, index) => {
      const lines = section.text.split('\n').map(lineInfo).filter(Boolean);
      total += lines.length; if (lines.length) populated++;
      const card = $('branch-' + index);
      card.classList.toggle('empty', !lines.length);
      card.hidden = $('hide-empty').checked && !lines.length && document.activeElement !== $('text-' + index);
      card.querySelector('.bond-list-branch-count').textContent = lines.length ? lines.length + ' 条报价' : '暂无报价';
      const issues = card.querySelector('.bond-list-issue'); issues.replaceChildren();
      for (const line of lines.filter(item => !item.coded)) {
        const result = lookupResults[line.name];
        const row = document.createElement('div');
        row.textContent = !line.ready ? '请补充简称后的逗号和报价：' + line.name
          : result?.status === 'missing' ? '未找到债券：' + line.name
          : result?.status === 'error' ? '返回信息不完整：' + line.name
          : result?.status === 'ambiguous' ? '请选择代码：' + line.name + ' ' : '待补码：' + line.name;
        if (result?.status === 'ambiguous') for (const match of result.matches) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'button subtle';
          button.textContent = match.code + ' · ' + match.market;
          button.addEventListener('click', () => { applyCodes({ [line.name]: { status: 'matched', matches: [match] } }); });
          row.append(button);
        }
        issues.append(row);
      }
    });
    $('counts').textContent = populated + ' 个分行 · ' + total + ' 条报价';
    $('fill').disabled = !loaded || Boolean(loading) || busy || !pendingNames().length;
    $('fill').textContent = busy ? '正在查询…' : '补齐代码';
    renderResults();
  }
  function scheduleLookup() {
    clearTimeout(lookupTimer);
    if (active && loaded && !loading && !flushing && $('auto').checked && !busy && !root.querySelector('[data-composing]')) {
      lookupTimer = setTimeout(() => { void fill(false); }, 1200);
    }
  }
  function applyCodes(results, snapshots = null) {
    let inserted = 0;
    sections.forEach((section, index) => {
      // A response must never replace input edited while DM was running.
      if (snapshots && section.text !== snapshots[index]) return;
      const oldText = section.text;
      const additions = [];
      section.text = oldText.split('\n').map(line => {
        const info = lineInfo(line);
        const result = info && !info.coded && info.ready ? results[info.name] : null;
        if (result?.status !== 'matched') { additions.push(0); return line; }
        inserted++;
        const code = result.matches[0].code;
        additions.push(code.length + 1 - (line.length - line.trimStart().length));
        return code + '，' + line.trimStart();
      }).join('\n');
      const textarea = $('text-' + index);
      if (textarea.value !== section.text) {
        const focused = document.activeElement === textarea;
        const atEnd = textarea.selectionStart === oldText.length;
        const oldStart = textarea.selectionStart, oldEnd = textarea.selectionEnd;
        const offset = position => oldText.slice(0, position).split('\n').reduce((sum, _, lineIndex) => sum + additions[lineIndex], 0);
        textarea.value = section.text;
        if (focused) textarea.setSelectionRange(atEnd ? section.text.length : oldStart + offset(oldStart), atEnd ? section.text.length : oldEnd + offset(oldEnd));
        fit(textarea);
      }
    });
    if (inserted) changed();
    return inserted;
  }
  function fill(manual) {
    if (!active || !loaded || loading || flushing || busy || root.querySelector('[data-composing]')) return Promise.resolve();
    const names = pendingNames().filter(name => manual || !failedNames.has(name));
    if (!names.length) return Promise.resolve();
    const snapshots = sections.map(section => section.text), version = editVersion;
    const controller = new AbortController(), generation = lookupGeneration, selectedMode = requestMode();
    lookupAbort = controller;
    const current = () => generation === lookupGeneration && lookupAbort === controller && !controller.signal.aborted;
    busy = true; renderSummary();
    lookupPromise = (async () => {
      try {
        const all = {};
        for (let start = 0; start < names.length; start += 20) {
          if (!active || !current()) return;
          const response = await api('lookup', { names: names.slice(start, start + 20) }, controller.signal);
          const results = response.results || {};
          Object.assign(all, Object.fromEntries(Object.entries(results).map(([name, result]) => [name, { ...result, requestMode: selectedMode }])));
        }
        if (!active || !current() || root.querySelector('[data-composing]')) return;
        lookupResults = { ...lookupResults, ...all };
        for (const [name, result] of Object.entries(all)) {
          if (result.status !== 'matched') failedNames.add(name); else failedNames.delete(name);
        }
        const count = applyCodes(all, snapshots);
        const unresolved = Object.values(all).filter(result => result.status !== 'matched').length;
        if (unresolved) notify('已补齐 ' + count + ' 条报价；还有 ' + unresolved + ' 个简称需要核对，详见分行下方提示。', true);
        else if (count) notify('已补齐 ' + count + ' 条报价，价格与分行保持原样。');
      } catch (error) {
        if (current()) { names.forEach(name => failedNames.add(name)); notify(error.status === 429 ? rateLimitMessage(error, selectedMode) : error.message, true); }
      } finally {
        if (generation === lookupGeneration && lookupAbort === controller) {
          busy = false; lookupAbort = null; lookupPromise = null; renderSummary();
          if (active && (editVersion !== version || controller.signal.aborted)) scheduleLookup();
        }
      }
    })();
    return lookupPromise;
  }
  function download(text, name) {
    const url = URL.createObjectURL(new Blob(['\ufeff' + text.replace(/\r?\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function validDraft(draft) {
    return draft && Number.isSafeInteger(draft.revision) && draft.revision >= 0 && Array.isArray(draft.sections)
      && draft.sections.length > 0 && draft.sections.every(section => section && typeof section.title === 'string' && typeof section.text === 'string');
  }
  function restoreBackup(userId) {
    // Preserve the keys used by the existing online OFR/BID editor.
    backupKey = 'bond-list-cloud-draft-v1:' + userId;
    recoveryKey = 'bond-list-cloud-recovery-v1:' + userId;
    let recovery;
    try { recovery = JSON.parse(localStorage.getItem(backupKey)); } catch {}
    if (validDraft(recovery) && recovery.revision === revision) {
      sections = recovery.sections; dirty = true; notify('已恢复上次尚未保存的输入。');
    } else if (validDraft(recovery)) {
      try {
        let prior = JSON.parse(localStorage.getItem(recoveryKey) || '[]');
        if (!Array.isArray(prior)) prior = [];
        if (!prior.some(item => JSON.stringify(item) === JSON.stringify(recovery))) prior.push(recovery);
        localStorage.setItem(recoveryKey, JSON.stringify(prior)); localStorage.removeItem(backupKey);
      } catch { notify('旧草稿备份无法归档，请先导出当前草稿。', true); }
    }
    try { archived = JSON.parse(localStorage.getItem(recoveryKey) || '[]'); } catch { archived = []; }
    archived = Array.isArray(archived) ? archived.filter(validDraft) : [];
    $('recovery-box').hidden = !archived.length;
  }
  function load({ refresh = false } = {}) {
    if (loaded && (!refresh || dirty || savePromise)) return Promise.resolve();
    if (loading) return loading;
    const version = editVersion;
    stopCoupons();
    retryState();
    notify('');
    $('save-state').textContent = '正在读取清单…';
    $('fill').disabled = true;
    $('copy').disabled = true;
    clearTimeout(lookupTimer);
    loading = (async () => {
      try {
        const state = await api('state');
        // A refresh must not replace input or a write started while it was reading.
        if (refresh && (editVersion !== version || dirty || savePromise)) return;
        if (metadataUserId && metadataUserId !== state.userId) { zeroCouponConfirmations.clear(); stopCoupons(true); }
        metadataUserId = state.userId;
        sections = state.sections; revision = state.revision;
        restoreBackup(state.userId);
        failedNames.clear(); lookupResults = {};
        loaded = true; renderEditors(); renderSummary(); $('export').disabled = false;
        $('save-state').textContent = dirty ? '正在保存…' : savedLabel;
        $('save-dot').style.color = 'var(--success, #628a66)';
        if (dirty) void save();
      } catch (error) {
        if (refresh && (editVersion !== version || dirty || savePromise)) return;
        notify(error.message, true);
        if (editVersion === version) $('save-state').textContent = loaded ? '刷新失败 · 已载入内容保留' : '读取失败';
        retryState('load');
      } finally {
        loading = null;
        if (loaded) { renderSummary(); scheduleLookup(); scheduleCoupons(); }
      }
    })();
    return loading;
  }
  function setMode(nextMode) {
    mode = nextMode;
    for (const name of ['results', 'editor']) {
      $('tab-' + name).setAttribute('aria-selected', String(mode === name));
      $('tab-' + name).tabIndex = mode === name ? 0 : -1;
      $(name + '-panel').hidden = mode !== name;
    }
    if (mode === 'editor' && loaded) requestAnimationFrame(fitEditors);
  }
  function readFilters() {
    filters.types = BOND_TYPES.filter(type => typeInputs.get(type).checked);
    filters.couponOp = $('coupon-op').value;
    filters.couponMin = $('coupon-min').value; filters.couponMax = $('coupon-max').value;
    filters.missing = $('missing').value;
    $('types-label').textContent = filters.types.length ? filters.types.join('、') : '全部品种';
    $('coupon-min').disabled = filters.couponOp === 'any';
    $('coupon-max').disabled = filters.couponOp !== 'between';
    $('coupon-max-wrap').hidden = filters.couponOp !== 'between';
    $('coupon-min').setAttribute('aria-label', filters.couponOp === 'between' ? '票面利率下限' : '票面利率数值');
    renderResults();
  }
  for (const type of BOND_TYPES) {
    const label = document.createElement('label'); label.className = 'bond-list-toggle';
    const input = document.createElement('input'); input.type = 'checkbox'; input.setAttribute('aria-label', type);
    const text = document.createElement('span'); text.textContent = type;
    input.addEventListener('change', readFilters); label.append(input, text); $('types-options').append(label); typeInputs.set(type, input);
  }
  for (const name of ['results', 'editor']) {
    $('tab-' + name).addEventListener('click', () => setMode(name));
    $('tab-' + name).addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const nextMode = event.key === 'Home' ? 'results' : event.key === 'End' ? 'editor' : mode === 'results' ? 'editor' : 'results';
      setMode(nextMode); $('tab-' + nextMode).focus();
    });
  }
  for (const id of ['coupon-op', 'missing']) $(id).addEventListener('change', readFilters);
  for (const id of ['coupon-min', 'coupon-max']) $(id).addEventListener('input', readFilters);
  for (const side of ['all', 'ofr', 'bid']) {
    $('side-' + side).addEventListener('click', () => {
      filters.side = side;
      for (const value of ['all', 'ofr', 'bid']) $('side-' + value).setAttribute('aria-pressed', String(value === side));
      renderResults();
    });
  }
  $('filters-clear').addEventListener('click', () => {
    for (const input of typeInputs.values()) input.checked = false;
    filters.side = 'all'; $('coupon-op').value = 'any'; $('coupon-min').value = ''; $('coupon-max').value = ''; $('missing').value = 'all';
    for (const value of ['all', 'ofr', 'bid']) $('side-' + value).setAttribute('aria-pressed', String(value === 'all'));
    readFilters();
  });
  setMode('results');
  $('fill').addEventListener('click', () => fill(true));
  $('coupons-refresh').addEventListener('click', () => fetchCoupons(true));
  $('auto').addEventListener('change', scheduleLookup);
  $('hide-empty').addEventListener('change', () => { if (loaded) { renderSummary(); fitEditors(); } });
  $('export').addEventListener('click', () => download(output(true), 'OFR-BID-草稿.txt'));
  $('recovery-download').addEventListener('click', () => download(archived.map((item, index) => '恢复草稿 ' + (index + 1)
    + '\nOFR/BID' + item.sections.map(section => '\n\n' + section.title + '\n' + section.text).join(''))
    .join('\n\n==========\n\n'), 'OFR-BID-恢复草稿.txt'));
  $('retry').addEventListener('click', () => retryMode === 'load' ? load({ refresh: true }) : save());
  $('copy').addEventListener('click', async () => {
    if ($('copy').disabled) return;
    const text = selectedText, count = selectedCount, filtered = filterActive;
    const area = document.createElement('textarea');
    area.value = text; area.setAttribute('readonly', ''); area.setAttribute('aria-label', '复制用文本');
    area.style.position = 'fixed'; area.style.top = '-10000px';
    document.body.append(area); area.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch {}
    area.remove(); $('copy').focus();
    if (!copied) try {
      await Promise.race([navigator.clipboard.writeText(text), new Promise((_, reject) => setTimeout(() => reject(new Error('复制超时')), 2000))]);
      copied = true;
    } catch {}
    if (copied) { const message = filtered ? '已复制 ' + count + ' 条筛选报价。' : '发送版已复制，可直接粘贴给中介。'; notify(message); onToast?.(message); }
    else notify('浏览器未允许复制，可在右侧预览中选中文字复制。', true);
  });
  window.addEventListener('beforeunload', event => {
    if (dirty) { backup(); event.preventDefault(); event.returnValue = ''; }
  });
  document.addEventListener('bond-ui-change', () => {
    if (active && loaded) requestAnimationFrame(fitEditors);
  });
  // Initial DM results can arrive before the host's database gate reveals this view.
  // Refit when the editor becomes visible or its column width changes.
  if (typeof ResizeObserver === 'function') {
    let editorWidth = 0;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width === editorWidth) return;
      editorWidth = width;
      if (width > 0 && active && loaded) fitEditors();
    });
    observer.observe(root);
  }

  return {
    resetDataSource() {
      clearMetadataLimitNotice();
      clearTimeout(lookupTimer);
      lookupGeneration++;
      lookupAbort?.abort(); lookupAbort = null; lookupPromise = null; busy = false;
      failedNames.clear(); lookupResults = {};
      stopCoupons(true);
      renderSummary(); scheduleLookup(); scheduleCoupons();
    },
    async setActive(nextActive) {
      const entering = Boolean(nextActive) && !active;
      active = Boolean(nextActive);
      if (!active) { clearTimeout(lookupTimer); lookupAbort?.abort(); stopCoupons(); return; }
      if (entering) resetMetadataAttempts();
      await load({ refresh: entering && !flushing });
      if (loaded && active) { fitEditors(); scheduleLookup(); scheduleCoupons(); }
    },
    async flushSave() {
      flushing = true;
      stopCoupons();
      renderResults();
      clearTimeout(saveTimer);
      // A pending DM response may insert codes, so finish/cancel it before the final save.
      clearTimeout(lookupTimer);
      if (loading) await loading;
      if (lookupPromise) { lookupAbort?.abort(); await lookupPromise; }
      do { if (!await save()) return false; } while (dirty);
      return true;
    },
    // Only resume after an attempted logout has stopped; no lookup may add codes
    // between the last confirmed save and the logout request.
    resume() { flushing = false; resetMetadataAttempts(); renderResults(); scheduleLookup(); scheduleCoupons(); },
    hasAccess() { return access; },
    clearAccess() { accessVersion++; zeroCouponConfirmations.clear(); setAccess(false); stopCoupons(true); renderResults(); },
    hasPendingChanges() { return dirty || Boolean(savePromise); }
  };
}
