import test from "node:test";
import assert from "node:assert/strict";
import { createProjectTargetNotes } from "../project-target-note.js";

const decode = value => value.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
}[entity]));

// A small DOM with real bubbling/focus transitions, limited to this module's markup.
class Element {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName; this.ownerDocument = ownerDocument; this.children = [];
    this.parentElement = null; this.listeners = new Map(); this.attributes = {}; this.dataset = {};
    this.className = ""; this.value = ""; this.textContent = "";
    this.style = {}; this.scrollHeight = 26;
    this.selectionStart = 0; this.selectionEnd = 0; this.selectionDirection = "none";
    this.classList = { toggle: (name, force) => {
      const names = new Set(this.className.split(/\s+/).filter(Boolean));
      if (force) names.add(name); else names.delete(name);
      this.className = [...names].join(" ");
    } };
  }
  append(child) { child.parentElement = this; this.children.push(child); }
  contains(child) { return child === this || this.children.some(next => next.contains(child)); }
  matches(selector) { return selector.startsWith(".") && this.className.split(/\s+/).includes(selector.slice(1)); }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, listener) { const entries = this.listeners.get(type) || []; entries.push(listener); this.listeners.set(type, entries); }
  emit(type, details = {}) {
    const event = {
      target: this, stopped: false, defaultPrevented: false,
      stopPropagation() { this.stopped = true; }, preventDefault() { this.defaultPrevented = true; },
      ...details,
    };
    for (let element = this; element; element = element.parentElement) {
      for (const listener of element.listeners.get(type) || []) listener(event);
      if (event.stopped) break;
    }
    return event;
  }
  focus(options) {
    this.lastFocusOptions = options;
    const old = this.ownerDocument.activeElement;
    this.ownerDocument.activeElement = this;
    if (old && old !== this) old.emit("focusout", { relatedTarget: this });
  }
  setSelectionRange(start, end, direction = "none") { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; }
  set innerHTML(html) {
    const oldFocused = this.ownerDocument.activeElement;
    for (const child of this.children) child.parentElement = null;
    this.children = []; this.textContent = "";
    if (oldFocused && oldFocused !== this && oldFocused.closest(".project-target-note")) {
      this.ownerDocument.activeElement = null;
      // A retired node can emit a delayed focusout when its owner is redrawn.
      oldFocused.emit("focusout", { relatedTarget: null });
    }
    const stack = [this];
    for (const token of html.match(/<[^>]*>|[^<]+/g) || []) {
      if (token.startsWith("</")) { stack.pop(); continue; }
      if (token.startsWith("<")) {
        const tag = token.match(/^<([\w-]+)/)[1];
        const child = new Element(tag, this.ownerDocument);
        for (const attribute of token.matchAll(/([\w-]+)="([^"]*)"/g)) {
          const value = decode(attribute[2]); child.attributes[attribute[1]] = value;
          if (attribute[1] === "class") child.className = value;
          if (attribute[1].startsWith("data-")) child.dataset[attribute[1].slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
        }
        stack.at(-1).append(child);
        if (!token.endsWith("/>")) stack.push(child);
      } else {
        const parent = stack.at(-1); const text = decode(token);
        parent.textContent += text;
        if (parent.tagName === "textarea") parent.value += text;
      }
    }
  }
}

function fixture({ save, beforeEdit, projects: initial } = {}) {
  const document = { activeElement: null };
  const container = new Element("div", document);
  const projects = new Map((initial || [
    { id: "one", shortName: "26测试MTN001", targetQuoteNote: "目标 3000万，2.0%" },
    { id: "two", shortName: "26测试SCP001", targetQuoteNote: "" },
  ]).map(project => [String(project.id), { ...project }]));
  const saves = [], calls = [];
  const editor = createProjectTargetNotes({
    getProject: id => projects.get(id),
    beforeEdit() { calls.push("beforeEdit"); beforeEdit?.(projects, render); },
    saveNote(id, text) { calls.push("save:" + id); save?.(id, text, projects, render); saves.push({ id, text }); projects.get(id).targetQuoteNote = text; },
  });
  let rowClicks = 0, rowKeys = 0, rowPointers = 0;
  function render() {
    editor.captureFocus();
    container.innerHTML = [...projects.values()].map(project => `<div class="row">${editor.render(project)}</div>`).join("");
    for (const row of container.querySelectorAll(".row")) {
      row.addEventListener("click", () => rowClicks++);
      row.addEventListener("pointerdown", () => rowPointers++);
      row.addEventListener("keydown", () => rowKeys++);
    }
    editor.bind(container);
  }
  const box = id => container.querySelectorAll(".project-target-note").find(element => element.dataset.targetNoteId === id);
  const input = id => box(id).querySelector(".project-target-note-input");
  const action = (id, type) => box(id).querySelector(".project-target-note-" + type);
  const edit = id => action(id, "edit").emit("click");
  const type = (id, value) => { const area = input(id); area.value = value; area.setSelectionRange(value.length, value.length); area.emit("input"); return area; };
  render();
  return { editor, container, document, projects, saves, calls, render, box, input, action, edit, type,
    rowEvents: () => ({ rowClicks, rowKeys, rowPointers }) };
}

test("render escapes project ids, names and notes in both read and edit markup", () => {
  const project = { id: 'a" onclick="alert(1)', shortName: '<img src=x onerror="1">', targetQuoteNote: '</textarea><script>alert(1)</script>&"' };
  const env = fixture({ projects: [project] });
  const html = env.editor.render(project);
  assert.ok(html.includes('data-target-note-id="a&quot; onclick=&quot;alert(1)"'));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;&amp;&quot;"));
  assert.ok(!html.includes("<script>"));
  env.edit(project.id);
  assert.equal(env.input(project.id).value, project.targetQuoteNote);
  assert.equal(env.input(project.id).attributes["aria-label"], project.shortName + "备注");
  assert.equal(env.input(project.id).attributes.maxlength, "2000");
});

test("note click, pointer and keyboard events never open the project row", () => {
  const env = fixture();
  env.action("one", "edit").children[0].emit("pointerdown");
  env.action("one", "edit").children[0].emit("click");
  env.input("one").emit("keydown", { key: "ArrowLeft" });
  env.type("one", "新的目标");
  env.action("one", "save").emit("click");
  assert.deepEqual(env.rowEvents(), { rowClicks: 0, rowKeys: 0, rowPointers: 0 });
  assert.deepEqual(env.saves, [{ id: "one", text: "新的目标" }]);
});

test("empty notes only expose the bubble while populated note text itself opens editing", () => {
  const env = fixture();
  assert.equal(env.box("two").querySelector(".project-target-note-label"), null);
  assert.ok(env.action("two", "edit").className.includes("project-target-note-add"));
  assert.equal(env.box("one").querySelector(".project-target-note-label").parentElement, env.action("one", "edit"));
  env.box("one").querySelector(".project-target-note-text").emit("click");
  assert.equal(env.input("one").value, env.projects.get("one").targetQuoteNote);
  assert.equal(env.input("one").attributes.rows, "1");
  assert.equal(env.rowEvents().rowClicks, 0);
});

test("typing keeps a local draft and save trims whitespace and normalizes newlines", () => {
  const env = fixture(); env.edit("one");
  env.type("one", "  目标 5000万\r\n2.05%  ");
  assert.equal(env.saves.length, 0);
  assert.equal(env.editor.hasPendingChanges(), true);
  env.action("one", "save").emit("click");
  assert.deepEqual(env.saves, [{ id: "one", text: "目标 5000万\n2.05%" }]);
  assert.equal(env.box("one").querySelector(".project-target-note-text").textContent, "目标 5000万\n2.05%");
  assert.equal(env.editor.hasPendingChanges(), false);
});

test("blank save clears a note while an unchanged normalized draft avoids a write", () => {
  const env = fixture(); env.edit("one");
  env.type("one", "  目标 3000万，2.0% \n");
  assert.equal(env.editor.hasPendingChanges(), false);
  assert.equal(env.editor.flush(), true);
  assert.equal(env.saves.length, 0);
  env.edit("one"); env.type("one", " \r\n ");
  assert.equal(env.editor.flush(), true);
  assert.deepEqual(env.saves, [{ id: "one", text: "" }]);
  assert.ok(env.box("one").className.includes("is-empty"));
  assert.equal(env.box("one").querySelector(".project-target-note-label"), null);
});

test("focus within the note permits Cancel to discard the draft; leaving saves", () => {
  const env = fixture(); env.edit("one"); env.type("one", "不要保存");
  env.action("one", "cancel").focus();
  assert.equal(env.saves.length, 0);
  env.action("one", "cancel").emit("click");
  assert.equal(env.saves.length, 0);
  assert.equal(env.projects.get("one").targetQuoteNote, "目标 3000万，2.0%");
  assert.equal(env.document.activeElement, env.action("one", "edit"));
  env.edit("one"); env.type("one", "失焦保存");
  new Element("button", env.document).focus();
  assert.deepEqual(env.saves, [{ id: "one", text: "失焦保存" }]);
});

test("Enter permits multiline input, Ctrl/Meta Enter saves, and Escape cancels", () => {
  const env = fixture(); env.edit("one"); env.type("one", "第一行\n第二行");
  assert.equal(env.input("one").emit("keydown", { key: "Enter" }).defaultPrevented, false);
  assert.equal(env.saves.length, 0);
  assert.equal(env.input("one").emit("keydown", { key: "Enter", ctrlKey: true }).defaultPrevented, true);
  assert.equal(env.saves.length, 1);
  env.edit("one"); env.type("one", "取消");
  assert.equal(env.input("one").emit("keydown", { key: "Escape" }).defaultPrevented, true);
  assert.equal(env.saves.length, 1);
  env.edit("one"); env.type("one", "Mac 提交");
  env.input("one").emit("keydown", { key: "Enter", metaKey: true });
  assert.equal(env.saves[1].text, "Mac 提交");
  env.edit("one"); env.type("one", "按钮上也可取消");
  env.action("one", "save").focus();
  env.action("one", "save").emit("keydown", { key: "Escape" });
  assert.equal(env.input("one"), null);
  assert.equal(env.saves.length, 2);
});

test("IME composition never turns Enter or Escape into editor shortcuts", () => {
  const env = fixture(); env.edit("one"); env.type("one", "输入中");
  env.input("one").emit("compositionstart");
  assert.equal(env.input("one").emit("keydown", { key: "Enter", ctrlKey: true }).defaultPrevented, false);
  env.input("one").emit("keydown", { key: "Escape" });
  assert.ok(env.input("one")); assert.equal(env.saves.length, 0);
  env.input("one").emit("compositionend");
  env.input("one").emit("keydown", { key: "Enter", ctrlKey: true, isComposing: true });
  env.input("one").emit("keydown", { key: "Enter", ctrlKey: true, keyCode: 229 });
  assert.equal(env.saves.length, 0);
  env.input("one").emit("keydown", { key: "Enter", ctrlKey: true });
  assert.equal(env.saves[0].text, "输入中");
});

test("host redraw preserves the unsaved text, focus, selection and scroll position", () => {
  const env = fixture(); env.edit("one");
  const oldInput = env.type("one", "尚未保存的量价\n第二行");
  oldInput.setSelectionRange(2, 7, "backward");
  env.render();
  assert.equal(env.saves.length, 0);
  const nextInput = env.input("one");
  assert.notEqual(nextInput, oldInput);
  assert.equal(nextInput.value, "尚未保存的量价\n第二行");
  assert.equal(env.document.activeElement, nextInput);
  assert.deepEqual([nextInput.selectionStart, nextInput.selectionEnd, nextInput.selectionDirection], [2, 7, "backward"]);
  assert.deepEqual(nextInput.lastFocusOptions, { preventScroll: true });
  oldInput.emit("focusout", { relatedTarget: null });
  assert.equal(env.saves.length, 0);
  assert.equal(env.editor.flush(), true);
  assert.equal(env.saves[0].text, "尚未保存的量价\n第二行");
});

test("switching rows commits the old draft and reads the next note after beforeEdit", () => {
  const env = fixture({ beforeEdit(projects) { projects.get("two").targetQuoteNote = "详情刚保存的备注"; } });
  env.edit("one"); env.type("one", "第一条的新目标");
  env.edit("two");
  assert.deepEqual(env.calls, ["beforeEdit", "save:one", "beforeEdit"]);
  assert.equal(env.input("one"), null);
  assert.equal(env.input("two").value, "详情刚保存的备注");
  assert.deepEqual(env.saves, [{ id: "one", text: "第一条的新目标" }]);
});

test("save failure keeps the draft and error, prevents switching, and permits retry", () => {
  let failing = true;
  const env = fixture({ save() { if (failing) throw new Error("disk unavailable"); } });
  env.edit("one"); env.type("one", "失败后还在");
  assert.equal(env.editor.flush(), false);
  assert.equal(env.input("one").value, "失败后还在");
  assert.equal(env.box("one").querySelector(".project-target-note-status").textContent, "保存失败，请重试");
  assert.equal(env.editor.hasPendingChanges(), true);
  env.edit("two");
  assert.equal(env.input("two"), null); assert.equal(env.input("one").value, "失败后还在");
  env.render();
  assert.equal(env.box("one").querySelector(".project-target-note-status").textContent, "保存失败，请重试");
  failing = false;
  assert.equal(env.editor.flush(), true);
  assert.deepEqual(env.saves, [{ id: "one", text: "失败后还在" }]);
  assert.equal(env.editor.hasPendingChanges(), false);
});

test("bind is idempotent and saving redraws only the note box", () => {
  const env = fixture();
  const row = env.box("one").parentElement;
  const otherBox = env.box("two");
  env.editor.bind(env.container); env.editor.bind(env.container);
  env.edit("one"); env.type("one", "局部保存"); env.action("one", "save").emit("click");
  assert.equal(env.calls.filter(call => call === "beforeEdit").length, 1);
  assert.equal(env.saves.length, 1);
  assert.equal(env.box("one").parentElement, row);
  assert.equal(env.box("two"), otherBox);
});

test("beforeEdit can redraw the list without losing the requested editor", () => {
  const env = fixture({ beforeEdit(projects, render) {
    projects.get("one").targetQuoteNote = "详情表单刚更新";
    render();
  } });
  const oldBox = env.box("one");
  env.edit("one");
  assert.notEqual(env.box("one"), oldBox);
  assert.equal(env.input("one").value, "详情表单刚更新");
  assert.equal(env.document.activeElement, env.input("one"));
  env.type("one", "列表编辑完成");
  assert.equal(env.editor.flush(), true);
  assert.deepEqual(env.saves, [{ id: "one", text: "列表编辑完成" }]);
});

test("saveNote can redraw the list and the live note returns to read mode", () => {
  const env = fixture({ save(id, text, projects, render) {
    projects.get(id).targetQuoteNote = text;
    render();
  } });
  env.edit("one"); env.type("one", "保存时重绘");
  const oldBox = env.box("one");
  env.action("one", "save").emit("click");
  assert.notEqual(env.box("one"), oldBox);
  assert.equal(env.input("one"), null);
  assert.equal(env.box("one").querySelector(".project-target-note-text").textContent, "保存时重绘");
  assert.equal(env.editor.hasPendingChanges(), false);
  assert.equal(env.saves.length, 1);
});

test("explicit save restores edit-button focus while blur save keeps the external target focused", () => {
  const env = fixture(); env.edit("one"); env.type("one", "点击保存");
  env.action("one", "save").focus(); env.action("one", "save").emit("click");
  assert.equal(env.document.activeElement, env.action("one", "edit"));
  assert.deepEqual(env.action("one", "edit").lastFocusOptions, { preventScroll: true });
  env.edit("one"); env.type("one", "快捷键保存");
  env.input("one").emit("keydown", { key: "Enter", ctrlKey: true });
  assert.equal(env.document.activeElement, env.action("one", "edit"));
  env.edit("one"); env.type("one", "自动保存");
  const external = new Element("button", env.document); external.focus();
  assert.equal(env.document.activeElement, external);
  assert.equal(env.saves.at(-1).text, "自动保存");
});
