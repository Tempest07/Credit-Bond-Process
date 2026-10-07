'use strict';
const $ = id => document.getElementById(id);
const codePattern = /^\d{6,12}\.(?:IB|SH|SZ|BJ)$/i;
let sections = [], revision = 0, saveTimer, lookupTimer, saving = false, dirty = false, conflict = false, busy = false;
let failedNames = new Set(), lookupResults = {}, editVersion = 0;
const apiRoot = new URL('../api/bond-list/', location.href).pathname;
let backupKey = 'bond-list-cloud-draft-v1';
let recoveryKey = 'bond-list-cloud-recovery-v1';

function notify(message, error = false) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
  $('notice').classList.toggle('error', error);
}
async function api(path, body) {
  const response = await fetch(apiRoot + path.replace('/api/', ''), body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Bond-List': '1'}, body: JSON.stringify(body)});
  if (response.status === 401) { $('login-link').hidden = false; const error = new Error('请重新登录；未保存的输入可先导出草稿。'); error.status = 401; throw error; }
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || '请求失败'); error.status = response.status; throw error; }
  return result;
}
function lineInfo(line) {
  const raw = line.trim();
  if (!raw) return null;
  const fields = raw.split(/[，,]/);
  if (codePattern.test(fields[0].trim())) return {coded: true};
  const name = fields[0].trim();
  return {name, ready: fields.length > 1 && fields.slice(1).join(',').trim().length > 0};
}
function pendingNames() {
  return [...new Set(sections.flatMap(s => s.text.split('\n').map(lineInfo).filter(x => x && !x.coded && x.ready).map(x => x.name)))];
}
function output() {
  return 'OFR/BID' + sections.filter(s => s.text.trim()).map(s => '\n\n' + s.title + '\n' + s.text.trim()).join('');
}
function backup() {
  try { localStorage.setItem(backupKey, JSON.stringify({revision, sections})); }
  catch { notify('浏览器备份不可用，请留意上方云端保存状态。', true); }
}
function changed() {
  editVersion++;
  dirty = true;
  backup();
  $('save-state').textContent = '正在保存…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 450);
  renderSummary();
  scheduleLookup();
}
async function save() {
  if (saving || !dirty || conflict) return;
  saving = true;
  const snapshot = JSON.stringify(sections);
  try {
    const result = await api('/api/state', {revision, sections: JSON.parse(snapshot)});
    revision = result.revision;
    dirty = JSON.stringify(sections) !== snapshot;
    if (dirty) backup();
    else { try { localStorage.removeItem(backupKey); } catch {} }
    $('save-state').textContent = dirty ? '正在保存…' : '已保存到云端';
    $('save-dot').style.color = '#628a66';
  } catch (error) {
    conflict = error.status === 409;
    $('save-state').textContent = '尚未保存 · 请导出草稿';
    $('save-dot').style.color = '#b57735';
    notify(error.message, true);
  } finally {
    saving = false;
    if (dirty && !conflict && $('save-state').textContent === '正在保存…') save();
  }
}
function fit(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.max(62, textarea.scrollHeight + 2) + 'px';
}
function renderEditors() {
  $('branches').replaceChildren();
  sections.forEach((section, index) => {
    const card = document.createElement('div');
    card.className = 'branch'; card.id = 'branch-' + index;
    const top = document.createElement('div'); top.className = 'branch-top';
    const title = document.createElement('h4'); title.textContent = section.title;
    const count = document.createElement('span'); count.className = 'num';
    top.append(title, count);
    const textarea = document.createElement('textarea');
    textarea.id = 'text-' + index; textarea.setAttribute('aria-label', section.title + '报价');
    textarea.placeholder = '输入债券简称，报价…'; textarea.value = section.text; textarea.spellcheck = false;
    textarea.addEventListener('input', () => { section.text = textarea.value; fit(textarea); changed(); });
    textarea.addEventListener('compositionstart', () => { textarea.dataset.composing = '1'; clearTimeout(lookupTimer); });
    textarea.addEventListener('compositionend', () => { delete textarea.dataset.composing; scheduleLookup(); });
    const issue = document.createElement('div'); issue.className = 'issue'; issue.setAttribute('aria-live', 'polite');
    card.append(top, textarea, issue); $('branches').append(card); fit(textarea);
  });
}
function renderSummary() {
  let total = 0, unresolved = 0, active = 0;
  sections.forEach((section, index) => {
    const lines = section.text.split('\n').map(lineInfo).filter(Boolean);
    total += lines.length; if (lines.length) active++;
    const card = $('branch-' + index);
    card.classList.toggle('empty', !lines.length);
    card.hidden = $('hide-empty').checked && !lines.length && document.activeElement !== $('text-' + index);
    card.querySelector('.num').textContent = lines.length ? lines.length + ' 条报价' : '暂无报价';
    const issues = card.querySelector('.issue'); issues.replaceChildren();
    for (const line of lines.filter(x => !x.coded)) {
      unresolved++;
      const result = lookupResults[line.name];
      const row = document.createElement('div');
      row.textContent = !line.ready ? '请补充简称后的逗号和报价：' + line.name : result?.status === 'missing' ? 'DM 未找到：' + line.name : result?.status === 'error' ? 'DM 返回信息不完整：' + line.name : result?.status === 'ambiguous' ? '请选择代码：' + line.name + ' ' : '待补码：' + line.name;
      if (result?.status === 'ambiguous') for (const match of result.matches) {
        const button = document.createElement('button'); button.textContent = match.code + ' · ' + match.market;
        button.addEventListener('click', () => { applyCodes({[line.name]: {status: 'matched', matches: [match]}}); });
        row.append(button);
      }
      issues.append(row);
    }
  });
  $('counts').textContent = active + ' 个分行 · ' + total + ' 条报价';
  $('preview').textContent = output();
  $('copy-hint').textContent = unresolved ? unresolved + ' 条待补码或补全 · 处理后可复制发送版' : active ? '已略过 ' + (sections.length - active) + ' 个空分行 · 可直接粘贴发送' : '添加报价后，这里会生成发送版。';
  $('copy').disabled = !active || unresolved > 0 || busy;
  $('fill').disabled = busy || !pendingNames().length;
  $('fill').textContent = busy ? 'DM 查询中…' : '补齐代码';
}
function scheduleLookup() {
  clearTimeout(lookupTimer);
  if ($('auto').checked && !busy && !document.querySelector('[data-composing]')) lookupTimer = setTimeout(() => fill(false), 1200);
}
function applyCodes(results, snapshots = null) {
  let inserted = 0;
  sections.forEach((section, index) => {
    // Never apply a response to text that changed while that request was running.
    if (snapshots && section.text !== snapshots[index]) return;
    section.text = section.text.split('\n').map(line => {
      const info = lineInfo(line);
      const result = info && !info.coded && info.ready ? results[info.name] : null;
      if (result?.status !== 'matched') return line;
      inserted++;
      return result.matches[0].code + '，' + line.trimStart();
    }).join('\n');
    const textarea = $('text-' + index);
    if (textarea.value !== section.text) {
      const focused = document.activeElement === textarea;
      const atEnd = textarea.selectionStart === textarea.value.length;
      const oldStart = textarea.selectionStart, oldEnd = textarea.selectionEnd;
      const oldText = textarea.value;
      const offset = position => oldText.slice(0, position).split('\n').reduce((sum, fragment, lineIndex, parts) => {
        const fullLine = oldText.split('\n')[lineIndex];
        const info = lineInfo(fullLine);
        const match = info && !info.coded && info.ready ? results[info.name] : null;
        return sum + (match?.status === 'matched' ? match.matches[0].code.length + 1 - (fullLine.length - fullLine.trimStart().length) : 0);
      }, 0);
      textarea.value = section.text;
      if (focused) textarea.setSelectionRange(atEnd ? section.text.length : oldStart + offset(oldStart), atEnd ? section.text.length : oldEnd + offset(oldEnd));
      fit(textarea);
    }
  });
  if (inserted) changed();
  return inserted;
}
async function fill(manual) {
  if (busy) return;
  const names = pendingNames().filter(n => manual || !failedNames.has(n));
  if (!names.length) return;
  const snapshots = sections.map(s => s.text);
  const version = editVersion;
  busy = true; renderSummary();
  try {
    const all = {};
    for (let start = 0; start < names.length; start += 20) {
      const response = await api('/api/lookup', {names: names.slice(start, start + 20)});
      Object.assign(all, response.results);
    }
    lookupResults = {...lookupResults, ...all};
    for (const [name, result] of Object.entries(all)) if (result.status !== 'matched') failedNames.add(name); else failedNames.delete(name);
    const count = applyCodes(all, snapshots);
    const unresolved = Object.values(all).filter(x => x.status !== 'matched').length;
    if (unresolved) notify('已补齐 ' + count + ' 条报价；还有 ' + unresolved + ' 个简称需要核对，详见分行下方提示。', true);
    else if (count) notify('已通过 DM 补齐 ' + count + ' 条报价，价格与分行保持原样。');
  } catch (error) {
    names.forEach(n => failedNames.add(n)); notify(error.message, true);
  } finally {
    busy = false; renderSummary();
    if (editVersion !== version) scheduleLookup();
  }
}
function download(text, name) {
  const url = URL.createObjectURL(new Blob(['\ufeff' + text.replace(/\r?\n/g, '\r\n')], {type: 'text/plain;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('fill').addEventListener('click', () => fill(true));
$('auto').addEventListener('change', scheduleLookup);
$('hide-empty').addEventListener('change', () => { renderSummary(); sections.forEach((_, i) => { if (!$('branch-' + i).hidden) fit($('text-' + i)); }); });
$('export').addEventListener('click', () => download('OFR/BID' + sections.map(s => '\n\n' + s.title + '\n' + s.text.trim()).join(''), 'OFR-BID-草稿.txt'));
$('copy').addEventListener('click', async () => {
  // Synchronous copy also works in embedded browsers that leave Clipboard API
  // permission requests pending. Use the modern API only if needed.
  const area = document.createElement('textarea');
  area.value = output(); area.setAttribute('readonly', ''); area.setAttribute('aria-label', '复制用文本');
  area.style.position = 'fixed'; area.style.top = '-10000px';
  document.body.append(area); area.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch {}
  area.remove(); $('copy').focus();
  if (copied) { notify('发送版已复制，可直接粘贴给中介。'); return; }
  try {
    await Promise.race([navigator.clipboard.writeText(output()), new Promise((_, reject) => setTimeout(() => reject(new Error('复制超时')), 2000))]);
    notify('发送版已复制，可直接粘贴给中介。');
  }
  catch { notify('浏览器未允许复制，可在右侧预览中选中文字复制。', true); }
});
window.addEventListener('beforeunload', event => { if (dirty) { backup(); event.preventDefault(); event.returnValue = ''; } });
(async () => {
  try {
    const state = await api('/api/state'); sections = state.sections; revision = state.revision;
    backupKey += ':' + state.userId; recoveryKey += ':' + state.userId;
    let recovery;
    try { recovery = JSON.parse(localStorage.getItem(backupKey)); } catch {}
    if (recovery?.revision === revision && Array.isArray(recovery.sections)) {
      sections = recovery.sections; dirty = true; notify('已恢复上次尚未保存的输入。');
    } else if (recovery && Array.isArray(recovery.sections)) {
      // Store conflicts under a separate key so future edits cannot overwrite them.
      try {
        const archived = JSON.parse(localStorage.getItem(recoveryKey) || '[]');
        if (!archived.some(item => JSON.stringify(item) === JSON.stringify(recovery))) archived.push(recovery);
        localStorage.setItem(recoveryKey, JSON.stringify(archived));
        localStorage.removeItem(backupKey);
      } catch { notify('旧草稿备份无法归档，请先导出当前草稿。', true); }
    }
    let archived = [];
    try { archived = JSON.parse(localStorage.getItem(recoveryKey) || '[]'); } catch {}
    if (archived.length) {
      $('recovery-box').hidden = false;
      $('recovery-download').addEventListener('click', () => download(archived.map((item, i) => '恢复草稿 ' + (i + 1) + '\nOFR/BID' + item.sections.map(s => '\n\n' + s.title + '\n' + s.text).join('')).join('\n\n==========\n\n'), 'OFR-BID-恢复草稿.txt'));
    }
    renderEditors(); renderSummary(); $('export').disabled = false;
    $('save-state').textContent = dirty ? '正在保存…' : '已保存到云端';
    if (dirty) save(); scheduleLookup();
  } catch (error) { notify(error.message, true); $('save-state').textContent = '读取失败'; }
})();
