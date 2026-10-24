// Notes live in chrome.storage.local. Outside an extension (local development,
// tests) the store falls back to localStorage.

import { shortAddress } from "./links.js";

const KEY = "memopad.notes";
const V1_KEY = "stickyNotes"; // v1 kept an array of HTML strings in the popup's localStorage

const ext = globalThis.chrome?.storage?.local ? globalThis.chrome : null;

async function read() {
  if (ext) return (await ext.storage.local.get(KEY))[KEY] ?? [];
  return JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "[]");
}

async function write(notes) {
  if (ext) return ext.storage.local.set({ [KEY]: notes });
  globalThis.localStorage?.setItem(KEY, JSON.stringify(notes));
}

export function makeNote(text, extra = {}) {
  const now = Date.now();
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${now}-${Math.random().toString(36).slice(2)}`,
    text: String(text).trim(),
    page: null, // { url, title } of the page it was saved from, for search
    section: null, // id of the section it belongs to, if any
    createdAt: now,
    ...extra,
  };
}

// A note saved from the right-click menu: the selected text, or for "Save page"
// the page's title, with the page's address on the next line, written without
// https://www. The address is ordinary text in the note. Returns null when
// there's nothing to save.
export function noteFromPage(menuItemId, info, tab) {
  const url = tab?.url || info.pageUrl || "";
  const title = tab?.title ?? "";
  const words = (menuItemId === "save-page" ? title : (info.selectionText ?? "")).trim();
  if (!words && (menuItemId !== "save-page" || !url)) return null;
  const text = [words, url && shortAddress(url)].filter(Boolean).join("\n");
  return makeNote(text, { page: url ? { url, title } : null });
}

// A section is a named, foldable group. Notes join one through note.section.
export function makeSection(name = "") {
  return makeNote(name, { kind: "section", collapsed: false });
}

export const isSection = (item) => item.kind === "section";

// v1 saved each note's innerHTML, delete button included. Its editable notes
// put every line after the first in a <div>, so a new block starts a new line.
export function v1ToText(html) {
  return String(html)
    .replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<(div|p)\b[^>]*>/gi, "\n")
    .replace(/<\/(div|p)>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function migrateV1(existing, v1Json) {
  let old;
  try {
    old = JSON.parse(v1Json);
  } catch {
    return existing;
  }
  if (!Array.isArray(old)) return existing;
  // Skip notes already moved over (an interrupted migration may run again),
  // but keep duplicates the user made on purpose.
  const seen = new Set(existing.map((n) => n.text));
  const migrated = old
    .map(v1ToText)
    .filter((t) => t && !seen.has(t))
    .map((t) => makeNote(t));
  return [...existing, ...migrated];
}

export async function loadNotes() {
  let notes = await read();
  // 2.0 betas stored a search embedding on each note; search no longer uses one.
  if (notes.some((n) => "embedding" in n)) {
    notes = notes.map(({ embedding, ...n }) => n);
    await write(notes);
  }
  // 2.0 betas kept a saved page's address apart from the note (note.source);
  // now it's part of the note's text, and note.page keeps the title for search.
  if (notes.some((n) => "source" in n)) {
    notes = notes.map(({ source, ...n }) => {
      if (!source?.url) return n;
      const text = n.text.includes(source.url) ? n.text : [n.text, source.url].filter(Boolean).join("\n");
      return { ...n, text, page: { url: source.url, title: source.title ?? "" } };
    });
    await write(notes);
  }
  const v1 = globalThis.localStorage?.getItem(V1_KEY);
  if (v1) {
    notes = migrateV1(notes, v1);
    await write(notes);
    globalThis.localStorage.removeItem(V1_KEY);
  }
  return notes;
}

export const saveNotes = write;

// Newest first, like notes typed in the popup.
export async function addNote(note) {
  const notes = await read();
  notes.unshift(note);
  await write(notes);
  return notes;
}

export function onNotesChanged(callback) {
  ext?.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes[KEY]) callback(changes[KEY].newValue ?? []);
  });
}
