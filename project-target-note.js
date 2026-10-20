const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));

const normalizeNote = value => String(value ?? "").replace(/\r\n?/g, "\n").trim();
const projectName = project => String(project?.shortName || "项目");
const noteBubble = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/><path d="M7 7h10M7 11h6"/></svg>';

/** Keeps list-only note drafts independent of the project detail form and its autosave. */
export function createProjectTargetNotes({ getProject, beforeEdit = () => {}, saveNote }) {
  let draft = null;
  let container = null;
  let repainting = false;
  const boundBoxes = new WeakSet();
  const resizeAnimations = new WeakMap();

  function contents(project) {
    const editing = draft?.id === String(project.id);
    const name = projectName(project);
    const label = '<span class="project-target-note-label">备注</span>';
    if (editing) {
      return `<div class="project-target-note-content">${normalizeNote(project.targetQuoteNote) ? label : ""}<textarea class="project-target-note-input" aria-label="${escapeHtml(name)}备注" maxlength="2000" rows="1" placeholder="填写备注…">${escapeHtml(draft.text)}</textarea></div><div class="project-target-note-actions"><button type="button" class="project-target-note-save">保存</button><button type="button" class="project-target-note-cancel">取消</button><span class="project-target-note-status" role="status" aria-live="polite">${escapeHtml(draft.error)}</span></div>`;
    }
    if (!normalizeNote(project.targetQuoteNote)) {
      return `<button type="button" class="project-target-note-edit project-target-note-add" aria-label="添加${escapeHtml(name)}的备注" title="添加备注">${noteBubble}</button>`;
    }
    return `<button type="button" class="project-target-note-edit project-target-note-filled" aria-label="${escapeHtml(name)}的备注：${escapeHtml(project.targetQuoteNote)}，点击编辑" title="点击编辑备注">${label}<span class="project-target-note-text">${escapeHtml(project.targetQuoteNote)}</span></button>`;
  }

  function render(project) {
    const editing = draft?.id === String(project.id);
    const empty = !normalizeNote(editing ? draft.text : project.targetQuoteNote);
    return `<div class="project-target-note${empty ? " is-empty" : ""}${editing ? " is-editing" : ""}" data-target-note-id="${escapeHtml(project.id)}">${contents(project)}</div>`;
  }

  function findBox(id) {
    if (!container) return null;
    return [...container.querySelectorAll(".project-target-note")].find(box => box.dataset.targetNoteId === id) || null;
  }

  const currentBox = () => draft ? findBox(draft.id) : null;

  function resizeInput(input) {
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.max(input.scrollHeight + 1, 28)}px`;
  }

  function animateResize(box, previousHeight) {
    if (!box.animate || !previousHeight || box.ownerDocument.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const height = box.getBoundingClientRect().height;
    if (Math.abs(height - previousHeight) < 1) return;
    resizeAnimations.set(box, box.animate([
      { height: `${previousHeight}px` }, { height: `${height}px` },
    ], { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" }));
  }

  function rememberInput(input) {
    if (!draft || !input) return;
    draft.text = input.value;
    draft.start = input.selectionStart;
    draft.end = input.selectionEnd;
    draft.direction = input.selectionDirection || "none";
  }

  function captureFocus() {
    const input = currentBox()?.querySelector(".project-target-note-input");
    if (input) {
      rememberInput(input);
      draft.focus = input.ownerDocument.activeElement === input;
    }
    // Removing a focused textarea while the host redraws must not submit its draft.
    repainting = true;
  }

  function focusDraft(box) {
    const input = box?.querySelector(".project-target-note-input");
    if (!input || !draft) return;
    // HTML textarea parsing drops an initial newline; restore the exact live draft.
    if (input.value !== draft.text) input.value = draft.text;
    resizeInput(input);
    if (draft.focus) input.focus({ preventScroll: true });
    const length = input.value.length;
    input.setSelectionRange(Math.min(draft.start, length), Math.min(draft.end, length), draft.direction);
  }

  function updateBox(box, project) {
    if (!box) return;
    const previousHeight = box.getBoundingClientRect?.().height;
    resizeAnimations.get(box)?.cancel();
    const previousRepainting = repainting;
    repainting = true;
    try {
      const editing = draft?.id === String(project.id);
      box.classList.toggle("is-editing", editing);
      box.classList.toggle("is-empty", !normalizeNote(editing ? draft.text : project.targetQuoteNote));
      box.innerHTML = contents(project);
      focusDraft(box);
      animateResize(box, previousHeight);
    } finally { repainting = previousRepainting; }
  }

  function commit() {
    if (!draft) return true;
    const box = currentBox();
    const restoreFocus = !!box?.contains(box.ownerDocument.activeElement);
    rememberInput(box?.querySelector(".project-target-note-input"));
    const current = draft;
    const text = normalizeNote(current.text);
    try {
      // Even an unchanged draft can close without issuing a persistence write.
      if (text !== current.original) saveNote(current.id, text);
      draft = null;
      updateBox(findBox(current.id), { ...current.project, targetQuoteNote: text });
      if (restoreFocus) findBox(current.id)?.querySelector(".project-target-note-edit")?.focus({ preventScroll: true });
      return true;
    } catch {
      current.error = "保存失败，请重试";
      const status = findBox(current.id)?.querySelector(".project-target-note-status");
      if (status) status.textContent = current.error;
      return false;
    }
  }

  function cancel() {
    if (!draft) return;
    const box = currentBox();
    const current = draft;
    draft = null;
    updateBox(box, getProject(current.id) || current.project);
    box?.querySelector(".project-target-note-edit")?.focus({ preventScroll: true });
  }

  function start(box) {
    const id = box.dataset.targetNoteId;
    if (draft?.id === id) return;
    if (!commit()) return;
    beforeEdit();
    // Read after flushing detail autosave, so the draft starts from the current project.
    const project = getProject(id);
    if (!project) return;
    const text = String(project.targetQuoteNote ?? "");
    draft = {
      id: String(project.id), project, text, original: normalizeNote(text),
      start: text.length, end: text.length, direction: "none", focus: true,
      composing: false, error: "",
    };
    updateBox(findBox(id), project);
  }

  function bindBox(box) {
    if (boundBoxes.has(box)) return;
    boundBoxes.add(box);
    box.addEventListener("pointerdown", event => event.stopPropagation());
    box.addEventListener("click", event => {
      event.stopPropagation();
      if (event.target.closest(".project-target-note-edit")) start(box);
      else if (event.target.closest(".project-target-note-save")) commit();
      else if (event.target.closest(".project-target-note-cancel")) cancel();
    });
    box.addEventListener("input", event => {
      if (event.target.matches(".project-target-note-input") && draft?.id === box.dataset.targetNoteId) {
        rememberInput(event.target);
        const previousHeight = box.getBoundingClientRect?.().height;
        resizeAnimations.get(box)?.cancel();
        draft.error = "";
        const status = box.querySelector(".project-target-note-status");
        if (status) status.textContent = "";
        resizeInput(event.target);
        animateResize(box, previousHeight);
      }
    });
    box.addEventListener("compositionstart", () => { if (draft?.id === box.dataset.targetNoteId) draft.composing = true; });
    box.addEventListener("compositionend", event => {
      if (draft?.id === box.dataset.targetNoteId) { draft.composing = false; rememberInput(event.target); }
    });
    box.addEventListener("keydown", event => {
      event.stopPropagation();
      if (draft?.id !== box.dataset.targetNoteId) return;
      if (event.isComposing || draft.composing || event.keyCode === 229) return;
      if (event.key === "Escape") { event.preventDefault(); cancel(); }
      else if (event.target.matches(".project-target-note-input") && event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(); }
    });
    box.addEventListener("focusout", event => {
      if (repainting || !container?.contains(box) || draft?.id !== box.dataset.targetNoteId) return;
      if (event.relatedTarget && box.contains(event.relatedTarget)) return;
      commit();
    });
  }

  function bind(nextContainer) {
    container = nextContainer;
    try {
      for (const box of container.querySelectorAll(".project-target-note")) bindBox(box);
      focusDraft(currentBox());
    } finally { repainting = false; }
  }

  return {
    render, captureFocus, bind,
    flush: commit,
    hasPendingChanges() {
      rememberInput(currentBox()?.querySelector(".project-target-note-input"));
      return !!draft && normalizeNote(draft.text) !== draft.original;
    },
  };
}
