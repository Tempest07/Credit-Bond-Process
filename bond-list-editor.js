const codePattern = /^\d{6,12}\.(?:IB|SH|SZ|BJ)$/i;

export function initializeBondList({ onToast } = {}) {
  const root = document.querySelector('.view[data-view="bond-list"]');
  if (!root) return { setActive: async () => {}, flushSave: async () => true, hasPendingChanges: () => false };
  const $ = id => root.querySelector('#bondList-' + id);
  const apiRoot = new URL('./api/bond-list/', location.href).pathname;
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
  const savedLabel = local ? '本地已保存' : '云端已保存';
  let sections = [], revision = 0, editVersion = 0;
  let active = false, loaded = false, loading = null, dirty = false, conflict = false, flushing = false;
  let saveTimer, lookupTimer, savePromise = null, lookupPromise = null, lookupAbort = null;
  let backupKey, recoveryKey, archived = [], busy = false;
  const failedNames = new Set();
  let lookupResults = {};

  function notify(message, error = false) {
    $('notice').textContent = message;
    $('notice').hidden = !message;
    $('notice').classList.toggle('error', error);
  }
  function retryState(mode = '') {
    $('retry').hidden = !mode;
    $('retry').disabled = mode === 'conflict';
    $('retry').textContent = mode === 'load' ? '重新读取' : mode === 'conflict' ? '请导出后刷新' : '重试保存';
  }
  async function api(path, body, signal) {
    const response = await fetch(apiRoot + path, body === undefined ? { signal } : {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'X-Bond-List': '1' },
      body: JSON.stringify(body)
    });
    if (response.status === 401) {
      $('login-link').hidden = false;
      const error = new Error('请重新登录；未保存的输入可先导出草稿。');
      error.status = 401;
      throw error;
    }
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error || '请求失败');
      error.status = response.status;
      throw error;
    }
    $('login-link').hidden = true;
    return result;
  }
  function lineInfo(line) {
    const raw = line.trim();
    if (!raw) return null;
    const fields = raw.split(/[，,]/);
    if (codePattern.test(fields[0].trim())) return { coded: true };
    return { name: fields[0].trim(), ready: fields.length > 1 && fields.slice(1).join(',').trim().length > 0 };
  }
  function pendingNames() {
    return [...new Set(sections.flatMap(section => section.text.split('\n').map(lineInfo)
      .filter(line => line && !line.coded && line.ready).map(line => line.name)))];
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
      textarea.addEventListener('compositionstart', () => { textarea.dataset.composing = '1'; clearTimeout(lookupTimer); });
      textarea.addEventListener('compositionend', () => { delete textarea.dataset.composing; scheduleLookup(); });
      const issue = document.createElement('div'); issue.className = 'bond-list-issue'; issue.setAttribute('aria-live', 'polite');
      card.append(top, textarea, issue); $('branches').append(card); fit(textarea);
    });
  }
  function renderSummary() {
    let total = 0, unresolved = 0, populated = 0;
    sections.forEach((section, index) => {
      const lines = section.text.split('\n').map(lineInfo).filter(Boolean);
      total += lines.length; if (lines.length) populated++;
      const card = $('branch-' + index);
      card.classList.toggle('empty', !lines.length);
      card.hidden = $('hide-empty').checked && !lines.length && document.activeElement !== $('text-' + index);
      card.querySelector('.bond-list-branch-count').textContent = lines.length ? lines.length + ' 条报价' : '暂无报价';
      const issues = card.querySelector('.bond-list-issue'); issues.replaceChildren();
      for (const line of lines.filter(item => !item.coded)) {
        unresolved++;
        const result = lookupResults[line.name];
        const row = document.createElement('div');
        row.textContent = !line.ready ? '请补充简称后的逗号和报价：' + line.name
          : result?.status === 'missing' ? 'DM 未找到：' + line.name
          : result?.status === 'error' ? 'DM 返回信息不完整：' + line.name
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
    $('preview').textContent = output();
    $('copy-hint').textContent = unresolved ? unresolved + ' 条待补码或补全 · 处理后可复制发送版'
      : populated ? '已略过 ' + (sections.length - populated) + ' 个空分行 · 可直接粘贴发送'
      : '添加报价后，这里会生成发送版。';
    $('copy').disabled = !populated || unresolved > 0 || busy;
    $('fill').disabled = busy || !pendingNames().length;
    $('fill').textContent = busy ? 'DM 查询中…' : '补齐代码';
  }
  function scheduleLookup() {
    clearTimeout(lookupTimer);
    if (active && loaded && !flushing && $('auto').checked && !busy && !root.querySelector('[data-composing]')) {
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
    if (!active || !loaded || flushing || busy || root.querySelector('[data-composing]')) return Promise.resolve();
    const names = pendingNames().filter(name => manual || !failedNames.has(name));
    if (!names.length) return Promise.resolve();
    const snapshots = sections.map(section => section.text), version = editVersion;
    const controller = new AbortController();
    lookupAbort = controller;
    busy = true; renderSummary();
    lookupPromise = (async () => {
      try {
        const all = {};
        for (let start = 0; start < names.length; start += 20) {
          if (!active || controller.signal.aborted) return;
          const response = await api('lookup', { names: names.slice(start, start + 20) }, controller.signal);
          Object.assign(all, response.results);
        }
        if (!active || controller.signal.aborted || root.querySelector('[data-composing]')) return;
        lookupResults = { ...lookupResults, ...all };
        for (const [name, result] of Object.entries(all)) {
          if (result.status !== 'matched') failedNames.add(name); else failedNames.delete(name);
        }
        const count = applyCodes(all, snapshots);
        const unresolved = Object.values(all).filter(result => result.status !== 'matched').length;
        if (unresolved) notify('已补齐 ' + count + ' 条报价；还有 ' + unresolved + ' 个简称需要核对，详见分行下方提示。', true);
        else if (count) notify('已通过 DM 补齐 ' + count + ' 条报价，价格与分行保持原样。');
      } catch (error) {
        if (!controller.signal.aborted) { names.forEach(name => failedNames.add(name)); notify(error.message, true); }
      } finally {
        busy = false; lookupAbort = null; lookupPromise = null; renderSummary();
        if (active && (editVersion !== version || controller.signal.aborted)) scheduleLookup();
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
  function load() {
    if (loaded) return Promise.resolve();
    if (loading) return loading;
    retryState();
    notify('');
    $('save-state').textContent = '正在读取清单…';
    loading = (async () => {
      try {
        const state = await api('state');
        sections = state.sections; revision = state.revision;
        restoreBackup(state.userId);
        loaded = true; renderEditors(); renderSummary(); $('export').disabled = false;
        $('save-state').textContent = dirty ? '正在保存…' : savedLabel;
        $('save-dot').style.color = 'var(--success, #628a66)';
        if (dirty) void save();
        scheduleLookup();
      } catch (error) {
        notify(error.message, true); $('save-state').textContent = '读取失败'; retryState('load');
      } finally { loading = null; }
    })();
    return loading;
  }
  $('fill').addEventListener('click', () => fill(true));
  $('auto').addEventListener('change', scheduleLookup);
  $('hide-empty').addEventListener('change', () => { if (loaded) { renderSummary(); fitEditors(); } });
  $('export').addEventListener('click', () => download(output(true), 'OFR-BID-草稿.txt'));
  $('recovery-download').addEventListener('click', () => download(archived.map((item, index) => '恢复草稿 ' + (index + 1)
    + '\nOFR/BID' + item.sections.map(section => '\n\n' + section.title + '\n' + section.text).join(''))
    .join('\n\n==========\n\n'), 'OFR-BID-恢复草稿.txt'));
  $('retry').addEventListener('click', () => loaded ? save() : load());
  $('copy').addEventListener('click', async () => {
    const area = document.createElement('textarea');
    area.value = output(); area.setAttribute('readonly', ''); area.setAttribute('aria-label', '复制用文本');
    area.style.position = 'fixed'; area.style.top = '-10000px';
    document.body.append(area); area.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch {}
    area.remove(); $('copy').focus();
    if (!copied) try {
      await Promise.race([navigator.clipboard.writeText(output()), new Promise((_, reject) => setTimeout(() => reject(new Error('复制超时')), 2000))]);
      copied = true;
    } catch {}
    if (copied) { notify('发送版已复制，可直接粘贴给中介。'); onToast?.('发送版已复制'); }
    else notify('浏览器未允许复制，可在右侧预览中选中文字复制。', true);
  });
  window.addEventListener('beforeunload', event => {
    if (dirty) { backup(); event.preventDefault(); event.returnValue = ''; }
  });
  document.addEventListener('bond-ui-change', () => {
    if (active && loaded) requestAnimationFrame(fitEditors);
  });

  return {
    async setActive(nextActive) {
      active = Boolean(nextActive);
      if (!active) { clearTimeout(lookupTimer); lookupAbort?.abort(); return; }
      await load();
      if (loaded && active) { fitEditors(); scheduleLookup(); }
    },
    async flushSave() {
      flushing = true;
      clearTimeout(saveTimer);
      // A pending DM response may insert codes, so finish/cancel it before the final save.
      clearTimeout(lookupTimer);
      try {
        if (loading) await loading;
        if (lookupPromise) { lookupAbort?.abort(); await lookupPromise; }
        do { if (!await save()) return false; } while (dirty);
        return true;
      } finally { flushing = false; }
    },
    hasPendingChanges() { return dirty || Boolean(savePromise); }
  };
}
