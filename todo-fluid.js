import { createHoverIntent } from './todo-hover-intent.js?v=20260920-release-5203';

export function automaticTodoCard(counts) {
  const populated = counts.flatMap((count, index) => count > 0 ? [index] : []);
  return populated.length === 1 ? populated[0] : null;
}

export function initFluidTodos(stage) {
  if (!stage) return;
  const cards = [...stage.querySelectorAll(':scope > .ledger-command-card')];
  const lists = cards.map(card => card.querySelector('.cutoff-todo-list,.payment-todo-list'));
  const finePointer = matchMedia('(hover:hover) and (pointer:fine)');
  const reduced = matchMedia('(prefers-reduced-motion:reduce)');
  const enabled = () => document.documentElement.dataset.ui === 'beta';
  const compact = () => stage.clientWidth < 650;
  const rows = list => [...list.querySelectorAll(':scope > article')];
  let active = null, automatic = null, origin = null, pending = 0, lastWidth = 0;
  const rowAnimations = new Map();
  const intent = createHoverIntent(index => expand(index));
  const controls = cards.map((card, index) => {
    const head = card.querySelector('.payment-todo-head');
    const count = document.createElement('span');
    count.className = 'todo-fluid-count';
    head.querySelector('div').append(count);
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'todo-fluid-toggle';
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H4v4M16 4h4v4M4 16v4h4M20 16v4h-4"/></svg>';
    button.addEventListener('click', () => active === index ? restore() : expand(index));
    head.append(button);
    const hover = event => {
      if (!enabled() || event.pointerType !== 'mouse' || !finePointer.matches || compact() || active !== null) return;
      intent.move(index, event.clientX, event.clientY);
    };
    card.addEventListener('pointerenter', hover);
    card.addEventListener('pointermove', hover);
    card.addEventListener('pointerleave', intent.cancel);
    return { button, count, title: head.querySelector('h2').textContent };
  });

  function layout() {
    if (!enabled() || !stage.clientWidth) return;
    stage.classList.add('todo-fluid');
    const width = stage.clientWidth, mobile = compact(), gap = mobile ? 16 : 24;
    const inset = mobile ? 15 : 25, head = mobile ? 76 : 90;
    stage.style.setProperty('--todo-inset', `${inset}px`);
    stage.style.setProperty('--todo-head', `${head}px`);
    const baseWidth = mobile ? width : (width - gap) / 2;
    const heights = [];
    cards.forEach((card, index) => {
      const selected = active === index, muted = active !== null && !selected;
      const cardWidth = selected ? width : baseWidth;
      const list = lists[index], items = rows(list);
      const before = items.map(item => ({ x: item.offsetLeft, y: item.offsetTop }));
      list.style.width = `${cardWidth - inset * 2}px`;
      list.style.gridTemplateColumns = selected && width >= 780 ? 'repeat(2,minmax(0,1fr))' : 'minmax(0,1fr)';
      const height = head + inset + Math.max(200, list.offsetHeight);
      heights.push(height);
      card.style.width = `${cardWidth}px`;
      card.style.left = `${selected || mobile ? 0 : index * (baseWidth + gap)}px`;
      card.classList.toggle('is-expanded', selected);
      card.classList.toggle('is-muted', muted);
      card.inert = muted;
      card.setAttribute('aria-hidden', String(muted));
      const { button, count, title } = controls[index];
      count.textContent = String(items.length);
      button.hidden = automatic !== null;
      button.setAttribute('aria-expanded', String(selected));
      button.setAttribute('aria-label', `${selected ? '收起' : '展开'}${title}`);
      items.forEach((item, i) => {
        rowAnimations.get(item)?.cancel();
        const dx = before[i].x - item.offsetLeft, dy = before[i].y - item.offsetTop;
        if (!reduced.matches && (dx || dy)) {
          const animation = item.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 500, easing: 'cubic-bezier(.22,.8,.2,1)' });
          rowAnimations.set(item, animation);
          animation.finished.then(() => { if (rowAnimations.get(item) === animation) rowAnimations.delete(item); }, () => {});
        }
      });
    });
    const normalHeight = Math.max(...heights);
    cards.forEach((card, index) => {
      card.style.height = `${active === index || mobile ? heights[index] : normalHeight}px`;
      card.style.top = `${mobile && active === null && index ? heights[0] + gap : 0}px`;
    });
    stage.style.height = `${active !== null ? heights[active] : mobile ? heights[0] + heights[1] + gap : normalHeight}px`;
    stage.dataset.active = active === null ? '' : cards[active].id;
    stage.dataset.mode = automatic === null ? 'hover' : 'automatic';
  }

  function expand(index) {
    intent.cancel();
    if (active === index || !enabled()) return;
    origin = stage.getBoundingClientRect();
    active = index;
    layout();
  }
  function restore() { intent.cancel(); active = automatic; origin = null; layout(); }
  function refresh() {
    pending = 0;
    rowAnimations.forEach((animation, item) => { if (!item.isConnected) { animation.cancel(); rowAnimations.delete(item); } });
    const next = automaticTodoCard(lists.map(list => rows(list).length));
    if (next !== automatic) { automatic = next; active = next; origin = null; intent.cancel(); }
    layout();
    // Do not leave keyboard focus inside the card that became empty and hidden.
    if (enabled() && active !== null && cards.some((card, index) => index !== active && card.contains(document.activeElement))) {
      (lists[active].querySelector('button') || controls[active].button).focus({ preventScroll: true });
    }
  }
  const scheduleRefresh = () => { if (!pending) pending = requestAnimationFrame(refresh); };
  const observer = new MutationObserver(scheduleRefresh);
  lists.forEach(list => observer.observe(list, { childList: true }));
  document.addEventListener('pointermove', event => {
    if (!enabled() || active === null || !origin || event.pointerType !== 'mouse' || !finePointer.matches || compact()) return;
    const inside = rect => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside(origin) && !inside(stage.getBoundingClientRect())) restore();
  });
  // Keyboard users keep their card open while tabbing into its real actions.
  stage.addEventListener('focusout', () => requestAnimationFrame(() => {
    if (!stage.contains(document.activeElement) && active !== automatic) restore();
  }));
  stage.addEventListener('keydown', event => {
    if (event.key === 'Escape' && active !== null && automatic === null) {
      const button = controls[active].button;
      restore(); button.focus({ preventScroll: true }); event.stopPropagation();
    }
  });
  window.addEventListener('blur', restore);
  new ResizeObserver(() => {
    if (stage.clientWidth !== lastWidth) { lastWidth = stage.clientWidth; restore(); }
  }).observe(stage);
  document.addEventListener('bond-ui-change', () => {
    intent.cancel(); active = automatic; origin = null;
    if (enabled()) { refresh(); return; }
    rowAnimations.forEach(animation => animation.cancel()); rowAnimations.clear();
    stage.classList.remove('todo-fluid'); stage.style.removeProperty('height');
    cards.forEach((card, index) => {
      ['left', 'top', 'width', 'height'].forEach(name => card.style.removeProperty(name));
      card.classList.remove('is-expanded', 'is-muted'); card.inert = false; card.removeAttribute('aria-hidden');
      lists[index].style.removeProperty('width'); lists[index].style.removeProperty('grid-template-columns');
    });
  });
  refresh();
}

if (typeof document !== 'undefined') initFluidTodos(document.querySelector('.ledger-todo-zone'));
