// Locate wording in the current editable text; never rewrite the saved opinion.
export function findOpinionFieldRanges(text, field = {}) {
  const ranges = [];
  const capture = (pattern, source = text, offset = 0) => {
    for (const match of source.matchAll(pattern)) {
      const value = match[1] ?? match[0];
      const start = offset + match.index + match[0].length - value.length;
      ranges.push({ start, end: start + value.length });
    }
  };
  if (field.kind === 'issuer') {
    // Anchor to the investment target, not to an issuer mentioned as guarantor.
    capture(/联动投资[“"]?([^。，“”"\n]+)(?=[”"。，\n]|$)/gu);
  } else if (field.kind === 'scale') {
    capture(/(?:预计)?发行规模(?:合计)?\s*(【待补充发行规模】|\d[\d,.]*\s*(?:亿|万)?元)/gu);
  } else if (field.kind === 'amount') {
    capture(/(?:申请投资金额(?:合计)?不超过|建议投资金额(?:合计)?不超过|拟申请投标[^。\n]*?金额不超过|拟建议投标[^。\n]*?金额不超过)\s*(【待补充(?:投资|申请)金额】|\d[\d,.]*\s*(?:亿|万)?元)/gu);
  } else if (field.kind === 'creditRatio') {
    // Identical percentages in issuance, ratings or recommendations are not credit terms.
    for (const clause of text.matchAll(/授信方面[，,:：]\s*([^。\n]+)/gu)) {
      const offset = clause.index + clause[0].length - clause[1].length;
      for (const ratio of clause[1].matchAll(/【待补充比例】|\d+(?:\.\d+)?\s*[%％]/gu)) {
        if (Number.isFinite(field.value) && !ratio[0].startsWith('【') && Number.parseFloat(ratio[0]) !== field.value) continue;
        ranges.push({ start: offset + ratio.index, end: offset + ratio.index + ratio[0].length });
      }
    }
  } else if (field.kind === 'suggestedRatio') {
    capture(/投资比例不超过(?:最终发行规模的)?(【待补充投资比例】|\d+(?:\.\d+)?\s*[%％])/gu);
  } else if (field.kind === 'approver') {
    capture(/【待确认终批层级】|本笔(?:为房地产债业务，由|业务由)[^。\n]*终批。?/gu);
  } else if (field.kind === 'literal' && typeof field.value === 'string' && field.value) {
    let start = text.indexOf(field.value);
    while (start >= 0) {
      ranges.push({ start, end: start + field.value.length });
      start = text.indexOf(field.value, start + field.value.length);
    }
  }
  return ranges.sort((a, b) => a.start - b.start).filter((range, index, all) => !index || range.start >= all[index - 1].end);
}

export function createOpinionFieldLocator({ textarea, trace, status, onMissing }) {
  const document = textarea.ownerDocument;
  const layer = document.createElement('div');
  layer.className = 'opinion-highlight-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.hidden = true;
  const mirror = document.createElement('div');
  mirror.className = 'opinion-highlight-text';
  layer.append(mirror);
  textarea.parentElement.append(layer);
  let fields = [];

  function syncScroll() {
    layer.scrollTop = textarea.scrollTop;
    layer.scrollLeft = textarea.scrollLeft;
  }
  function syncGeometry() {
    if (layer.hidden) return;
    const style = getComputedStyle(textarea);
    for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontStretch', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textAlign', 'textIndent', 'textTransform', 'tabSize', 'wordBreak', 'overflowWrap', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) {
      mirror.style[property] = style[property];
    }
    layer.style.left = `${textarea.offsetLeft + textarea.clientLeft}px`;
    layer.style.top = `${textarea.offsetTop + textarea.clientTop}px`;
    layer.style.width = `${textarea.clientWidth}px`;
    layer.style.height = `${textarea.clientHeight}px`;
    syncScroll();
  }
  function clear() {
    layer.hidden = true;
    mirror.replaceChildren();
    trace.querySelectorAll('[data-opinion-field]').forEach(button => button.setAttribute('aria-pressed', 'false'));
    status.textContent = '';
  }
  function locate(index) {
    const item = fields[index];
    if (!item?.field) return;
    clear();
    const value = textarea.value;
    const ranges = findOpinionFieldRanges(value, item.field);
    if (!ranges.length) {
      status.textContent = '当前正文中未找到对应内容，可能已被手工修改或删除。';
      onMissing?.(status.textContent);
      return;
    }
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const range of ranges) {
      fragment.append(document.createTextNode(value.slice(cursor, range.start)));
      const mark = document.createElement('span');
      mark.className = 'opinion-field-highlight';
      mark.textContent = value.slice(range.start, range.end);
      fragment.append(mark);
      cursor = range.end;
    }
    fragment.append(document.createTextNode(value.slice(cursor) + '\u200b'));
    mirror.replaceChildren(fragment);
    layer.hidden = false;
    syncGeometry();
    // Scroll the editable surface, preserving the user's caret and native editing.
    const first = mirror.querySelector('.opinion-field-highlight');
    const offset = first.getBoundingClientRect().top - mirror.getBoundingClientRect().top;
    const lastLine = Math.min(first.getBoundingClientRect().height, Number.parseFloat(getComputedStyle(textarea).lineHeight) || 32);
    if (offset < textarea.scrollTop + 12 || offset + lastLine > textarea.scrollTop + textarea.clientHeight - 12) {
      textarea.scrollTop = Math.max(0, offset - textarea.clientHeight / 3);
    }
    syncScroll();
    trace.querySelector(`[data-opinion-field="${index}"]`)?.setAttribute('aria-pressed', 'true');
    status.textContent = `已定位：${item.label}`;
  }
  trace.addEventListener('click', event => {
    const button = event.target.closest('[data-opinion-field]');
    if (button && trace.contains(button)) locate(Number(button.dataset.opinionField));
  });
  textarea.addEventListener('input', clear);
  textarea.addEventListener('scroll', syncScroll, { passive: true });
  textarea.addEventListener('keydown', event => { if (event.key === 'Escape') clear(); });
  const observer = new ResizeObserver(syncGeometry);
  observer.observe(textarea);
  // UI Beta can change fonts without changing the textarea's dimensions.
  const appearanceObserver = new MutationObserver(syncGeometry);
  appearanceObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ui'] });
  return { clear, setFields(items) { fields = items; clear(); } };
}
