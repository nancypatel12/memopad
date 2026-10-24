import { findLinks } from "../lib/links.js";
import { search } from "../lib/search.js";
import { isSection, loadNotes, makeNote, makeSection, onNotesChanged, saveNotes } from "../lib/store.js";

const notesEl = document.getElementById("notes");
const input = document.getElementById("new-note");
const addButton = document.getElementById("add-note");
const picker = document.getElementById("note-section");
const searchEl = document.getElementById("search");
const sectionButton = document.getElementById("new-section");

let notes = await loadNotes(); // notes and section headers, in the user's order
let query = "";

// Storage

// A new section exists only on screen until it's named.
const saved = () => notes.filter((n) => n.text);

async function persist() {
  await saveNotes(saved());
  renderSoon();
}

// Redrawing between a press and its release would replace the button being
// clicked, and the click would be lost. So while a press is in progress, the
// redraw waits until the click has happened.
let pressing = false;
let renderPending = false;
function renderSoon() {
  if (pressing) renderPending = true;
  else render();
}
document.addEventListener("pointerdown", () => (pressing = true), true);
for (const type of ["pointerup", "pointercancel"]) {
  document.addEventListener(
    type,
    () => {
      pressing = false;
      setTimeout(() => {
        if (!renderPending) return;
        renderPending = false;
        render();
      }); // after the click
    },
    true,
  );
}

// Another view (or the right-click menu) changed the notes. Our own writes echo
// back here too; they match what we hold, so they're ignored. Items keep their
// identity, unsaved ones stay, and the one being typed in is left alone.
const signature = (list) => JSON.stringify(list.map((n) => [n.id, n.text, n.collapsed, n.section]));
const editingId = () => (document.activeElement?.isContentEditable ? document.activeElement.closest("[data-id]")?.dataset.id : null);

onNotesChanged((fresh) => {
  if (signature(fresh) === signature(saved())) return;
  const known = new Map(notes.map((n) => [n.id, n]));
  const editing = editingId();
  const unsaved = notes.filter((n) => !n.text);
  notes = [
    ...unsaved,
    ...fresh.map((n) => {
      const mine = known.get(n.id);
      if (!mine) return n;
      if (n.id !== editing) Object.assign(mine, n);
      return mine;
    }),
  ];
  renderSoon();
});

// Rendering. Sections come first, in the user's order, then loose notes. A note
// that belongs to a section (note.section) is drawn under that section,
// indented.

const membersOf = (section) => notes.filter((n) => !isSection(n) && n.section === section.id);

function render() {
  if (document.activeElement?.isContentEditable) return; // don't interrupt an edit
  updatePicker();
  if (query.trim()) {
    const results = search(query, notes.filter((n) => !isSection(n)));
    notesEl.replaceChildren(...results.map((note) => noteEl(note)));
    return;
  }
  const sections = notes.filter(isSection);
  const sectionIds = new Set(sections.map((s) => s.id));
  const els = [];
  for (const section of sections) {
    els.push(sectionEl(section));
    for (const member of membersOf(section)) {
      const el = noteEl(member, { reorderable: true });
      el.hidden = !!section.collapsed; // stays in the DOM so drag order stays complete
      els.push(el);
    }
  }
  for (const item of notes) {
    if (!isSection(item) && !sectionIds.has(item.section)) els.push(noteEl(item, { reorderable: true }));
  }
  notesEl.replaceChildren(...els);
}

function noteEl(note, { reorderable = false } = {}) {
  const el = document.createElement("div");
  el.className = "note";
  el.dataset.id = note.id;
  if (reorderable) {
    draggableFrom(el);
    setMembership(el, note.section && notes.some((n) => n.id === note.section) ? note.section : "");
  } else {
    el.classList.add("static"); // a search result: not draggable
  }

  const text = editable(note, "note-text", { onClick: true });
  el.append(text, deleteButton(note, "Delete note"));

  // Clicking the note's empty space edits it too, at the end. Handy when the
  // note is all link.
  el.addEventListener("click", (e) => {
    if (e.target === el && !text.isContentEditable && getSelection().isCollapsed) text.startEditing();
  });
  return el;
}

function sectionEl(section) {
  const el = document.createElement("div");
  el.className = section.collapsed ? "section collapsed" : "section";
  el.dataset.id = section.id;
  draggableFrom(el);

  const toggle = document.createElement("button");
  toggle.className = "toggle";
  toggle.textContent = ">"; // turned down when open (CSS)
  toggle.setAttribute("aria-label", section.collapsed ? "Show notes" : "Hide notes");
  toggle.setAttribute("aria-expanded", String(!section.collapsed));
  toggle.addEventListener("click", () => {
    section.collapsed = !section.collapsed;
    persist();
  });

  const name = editable(section, "section-name");
  name.dataset.placeholder = "Name";
  name.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      name.blur();
    }
  });

  const count = document.createElement("span");
  count.className = "count";
  count.textContent = section.collapsed ? String(membersOf(section).length || "") : "";

  el.append(toggle, name, count, deleteButton(section, "Delete section"));
  return el;
}

function setMembership(el, sectionId) {
  el.dataset.section = sectionId;
  el.classList.toggle("member", !!sectionId);
}

function deleteButton(item, label) {
  const button = document.createElement("button");
  button.textContent = "X";
  button.setAttribute("aria-label", label);
  button.addEventListener("click", () => {
    remove(item);
    persist();
  });
  return button;
}

// Deleting a section keeps its notes; they become loose notes where they stand.
function remove(item) {
  if (isSection(item)) for (const member of membersOf(item)) member.section = null;
  notes = notes.filter((n) => n !== item);
}

// Note text. A note's text is plain text. Any web address in it is shown as a
// link: a real link at rest, and only highlighted while editing, so typing
// works the same everywhere. Section names are always editable; note text
// becomes editable when clicked (anywhere but a link, which opens) and goes
// back to text with links when you leave it, so at rest it selects and copies
// like page text.

function showText(el, value, { editing = false } = {}) {
  el.replaceChildren();
  let at = 0;
  for (const { start, end, url } of findLinks(value)) {
    const link = document.createElement(editing ? "span" : "a");
    link.className = "link";
    if (!editing) {
      Object.assign(link, { href: url, target: "_blank", rel: "noopener", draggable: false }); // draggable: selects like the words around it
    }
    link.textContent = value.slice(start, end);
    el.append(value.slice(at, start), link);
    at = end;
  }
  el.append(value.slice(at));
}

// Positions in a note's text, counted in characters, so the cursor survives a
// redraw.
function charOffset(el, node, offset) {
  const range = document.createRange();
  range.setStart(el, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

function caretOffset(el) {
  const s = getSelection();
  return s.rangeCount && el.contains(s.anchorNode) ? charOffset(el, s.anchorNode, s.anchorOffset) : null;
}

function setCaret(el, offset) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (offset <= node.length) return getSelection().collapse(node, offset);
    offset -= node.length;
  }
  getSelection().collapse(el, el.childNodes.length);
}

// Where in the text a click landed.
function offsetAt(el, x, y) {
  const caret = document.caretRangeFromPoint?.(x, y);
  return caret && el.contains(caret.startContainer) ? charOffset(el, caret.startContainer, caret.startOffset) : null;
}

// Redraw the highlights only when an address appeared, vanished or changed
// length, so typing elsewhere leaves the browser's own undo alone.
function relink(el) {
  const value = el.textContent;
  const want = findLinks(value).map(({ start, end }) => `${start}-${end}`).join();
  const have = [...el.querySelectorAll(".link")].map((l) => `${charOffset(el, l, 0)}-${charOffset(el, l, 0) + l.textContent.length}`).join();
  if (want === have) return;
  const at = caretOffset(el);
  showText(el, value, { editing: true });
  if (at !== null) setCaret(el, at);
}

function editable(item, className, { onClick = false } = {}) {
  const text = document.createElement("div");
  text.className = className;
  text.contentEditable = onClick ? "false" : "plaintext-only";
  if (onClick) {
    showText(text, item.text);
    text.startEditing = (offset = item.text.length) => {
      showText(text, item.text, { editing: true });
      text.contentEditable = "plaintext-only";
      text.focus();
      setCaret(text, offset); // cursor where they clicked
    };
    text.addEventListener("input", (e) => {
      if (!e.isComposing) relink(text); // keep addresses blue as they're typed
    });
    text.addEventListener("click", (e) => {
      if (text.isContentEditable || !getSelection().isCollapsed || e.target.closest("a")) return; // editing, selecting, or opening a link
      text.startEditing(offsetAt(text, e.clientX, e.clientY) ?? undefined);
    });
    text.addEventListener("blur", () => {
      text.contentEditable = "false";
      showText(text, item.text);
    });
  } else {
    text.textContent = item.text;
  }

  // Saved as you type, so closing the popup mid-sentence loses nothing.
  let changed = false;
  text.addEventListener("input", () => {
    const value = text.textContent.trim();
    if (value === item.text) return;
    item.text = value;
    changed = true;
    saveNotes(saved());
  });
  text.addEventListener("blur", () => {
    if (!item.text) remove(item); // emptied, or a new section left unnamed
    else if (!changed) return;
    changed = false;
    persist();
  });
  return text;
}

// A link in a note opens in a new tab, unless the click was the end of a
// selection.
notesEl.addEventListener("click", (e) => {
  const link = e.target.closest("a.link");
  if (!link) return;
  if (!getSelection().isCollapsed) return e.preventDefault();
  openTab(e, link.href);
});

// Outside the extension (local development), the link's own target=_blank
// does it.
function openTab(e, url) {
  if (!globalThis.chrome?.tabs) return;
  e.preventDefault();
  chrome.tabs.create({ url });
}

// Adding. A new note goes first among the loose notes, or first in the section
// chosen beside Add Note. The choice lasts while the popup is open, so several
// notes can go to the same section in a row.

function updatePicker() {
  const sections = notes.filter((n) => isSection(n) && n.text);
  const chosen = picker.value;
  picker.replaceChildren(new Option("No Section", ""), ...sections.map((s) => new Option(s.text, s.id)));
  picker.value = sections.some((s) => s.id === chosen) ? chosen : "";
  picker.hidden = !sections.length;
}

function add() {
  const value = input.value.trim();
  if (!value) return;
  const section = notes.find((n) => n.id === picker.value) ?? null;
  if (section?.collapsed) section.collapsed = false; // open it to show the new note
  const note = makeNote(value, { section: section?.id ?? null });
  notes = [note, ...notes];
  input.value = "";
  fitInput();
  persist().then(() => {
    if (section) notesEl.querySelector(`[data-id="${note.id}"]`)?.scrollIntoView({ block: "nearest" });
    else notesEl.scrollTop = 0;
  });
}

// The note box grows with what's typed, from its CSS height up to its max-height.
const baseHeight = input.offsetHeight;
function fitInput() {
  input.style.height = "auto";
  input.style.height = `${Math.max(baseHeight, input.scrollHeight + 2)}px`;
}

input.addEventListener("input", fitInput);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add();
});
addButton.addEventListener("click", add);

// + Section starts a new section at the top, ready to be named.
sectionButton.addEventListener("click", () => {
  document.activeElement?.blur(); // finish whatever was being edited
  if (query) closeSearch({ refocus: false });
  const section = makeSection();
  notes = [section, ...notes];
  render();
  notesEl.scrollTop = 0;
  notesEl.querySelector(`[data-id="${section.id}"] .section-name`).focus();
});

// Reordering: drag a note or section by its edge. Sections stay above loose
// notes.
// Notes: dropped beside a note, they join that note's section (or stay loose);
// dropped on a header, they go first into that section; dropped below
// everything, they become loose.
// Sections: move with their notes among the other sections, never inside one
// and never below the loose notes.

let dragged = []; // the dragged row; for a section, its notes come along

// A row is draggable only while pressed on its edge, so selecting and editing
// text still work.
function draggableFrom(el) {
  el.addEventListener("mousedown", (e) => (el.draggable = !e.target.closest("[contenteditable], button, a")));
}

const isHeader = (el) => el.classList.contains("section");
const membersEls = (header) => [...notesEl.children].filter((el) => el.dataset.section === header.dataset.id);
const headerOf = (el) => (el.dataset.section ? notesEl.querySelector(`.section[data-id="${el.dataset.section}"]`) : null);
const endOf = (unit) => (isHeader(unit) ? (membersEls(unit).at(-1) ?? unit) : unit).nextSibling;
const firstLoose = () => [...notesEl.children].find((el) => !isHeader(el) && !el.dataset.section && !dragged.includes(el)) ?? null;
const upperHalf = (e, el) => {
  const { top, height } = el.getBoundingClientRect();
  return e.clientY < top + height / 2;
};

notesEl.addEventListener("dragstart", (e) => {
  const row = e.target.closest?.(".note, .section");
  if (!row?.draggable) return; // dragging selected text, not a row
  dragged = isHeader(row) ? [row, ...membersEls(row)] : [row];
  row.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", "");
});

notesEl.addEventListener("dragover", (e) => {
  if (!dragged.length) return;
  e.preventDefault();
  const over = e.target.closest(".note, .section");
  if (over && dragged.includes(over)) return;

  let anchor;
  if (!isHeader(dragged[0])) {
    const note = dragged[0];
    if (!over) {
      anchor = null; // empty space below everything
      setMembership(note, "");
    } else if (isHeader(over)) {
      anchor = over.nextSibling;
      setMembership(note, over.dataset.id);
    } else {
      anchor = upperHalf(e, over) ? over : over.nextSibling;
      setMembership(note, over.dataset.section);
    }
  } else {
    const unit = over ? (headerOf(over) ?? over) : null; // the section or loose note being passed
    if (dragged.includes(unit)) return;
    if (!unit || !isHeader(unit)) anchor = firstLoose(); // at most, the last section
    else anchor = over === unit && upperHalf(e, unit) ? unit : endOf(unit);
  }
  if (anchor === dragged[0]) return;
  for (const el of dragged) notesEl.insertBefore(el, anchor);
});

notesEl.addEventListener("dragend", () => {
  if (!dragged.length) return;
  dragged[0].classList.remove("dragging");
  dragged[0].draggable = false;
  dragged = [];
  const byId = new Map(notes.map((n) => [n.id, n]));
  notes = [...notesEl.querySelectorAll(".note, .section")].map((el) => {
    const item = byId.get(el.dataset.id);
    if (!isSection(item)) item.section = el.dataset.section || null;
    return item;
  });
  persist();
});

// Search: ⌘F (Ctrl+F) to open, Esc to close.

function closeSearch({ refocus = true } = {}) {
  searchEl.value = query = "";
  searchEl.hidden = true;
  render();
  if (refocus) input.focus();
}

searchEl.addEventListener("input", () => {
  query = searchEl.value;
  render();
});
searchEl.addEventListener("blur", () => {
  if (!query.trim()) closeSearch({ refocus: false });
});

document.addEventListener("keydown", (e) => {
  if (e.key === "f" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    searchEl.hidden = false;
    searchEl.focus();
    searchEl.select();
  } else if (e.key === "Escape" && !searchEl.hidden) {
    e.preventDefault(); // keep the popup open
    closeSearch();
  } else if (document.activeElement?.isContentEditable && (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey)))) {
    e.preventDefault();
    document.activeElement.blur(); // done editing
  }
});

// Scroll bars show only while their box is scrolling, then fade.
for (const el of [notesEl, input]) {
  let timer;
  el.addEventListener(
    "scroll",
    () => {
      el.classList.add("scrolling");
      clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove("scrolling"), 800);
    },
    { passive: true },
  );
}

// The title opens Memopad's review page in the Chrome Web Store.
document.getElementById("review").addEventListener("click", (e) => openTab(e, e.currentTarget.href));

render();
input.focus();
