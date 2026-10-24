import assert from "node:assert/strict";
import { test } from "node:test";

import { findLinks, shortAddress } from "../src/lib/links.js";
import { bm25, noteText, search, tokenize } from "../src/lib/search.js";
import { makeNote, migrateV1, noteFromPage, v1ToText } from "../src/lib/store.js";

// links.js

test("addresses in a note are found wherever they are, with or without https://", () => {
  const found = (text) => findLinks(text).map(({ start, end, url }) => [text.slice(start, end), url]);
  const nyt = "https://www.nytimes.com/2026/10/23/us/politics/justice-dept-alaska-senate-race-sullivan.html";
  assert.deepEqual(found(`Trump Officials Seek Block - The New York Times\n${nyt} `), [[nyt, nyt]]);
  assert.deepEqual(found("- nancypatel.me, then read www.bbc.co.uk/news."), [
    ["nancypatel.me", "https://nancypatel.me"],
    ["www.bbc.co.uk/news", "https://www.bbc.co.uk/news"],
  ]);
  assert.deepEqual(found("read this (https://arxiv.org/abs/1706.03762)."), [["https://arxiv.org/abs/1706.03762", "https://arxiv.org/abs/1706.03762"]]);
  for (const notALink of ["learn Node.js", "open file.txt", "ship v2.0", "e.g. tomorrow", "email nancy@example.com"]) {
    assert.deepEqual(findLinks(notALink), [], notALink);
  }
});

test("saved addresses drop https://www. but keep everything else", () => {
  assert.equal(shortAddress("https://www.nytimes.com/2026/10/23/us/politics/alaska.html?smid=nytcore"), "nytimes.com/2026/10/23/us/politics/alaska.html?smid=nytcore");
  assert.equal(shortAddress("https://nancypatel.me/"), "nancypatel.me");
  assert.equal(shortAddress("http://old-site.com/page"), "http://old-site.com/page"); // http stays: it might not open over https
  assert.equal(shortAddress("https://www.example.ru/x"), "https://www.example.ru/x"); // short form wouldn't be a link
});

// search.js

test("tokenize", () => {
  assert.deepEqual(tokenize("Hello, World! v2 a"), ["hello", "world", "v2"]);
});

test("bm25 prefix-matches while typing", () => {
  const s = bm25("meet", ["meeting with the team", "team lunch", "dentist"]);
  assert.ok(s[0] > 0 && s[1] === 0 && s[2] === 0);
});

test("search shows only notes with the words, best match first", () => {
  const notes = [
    { id: "a", text: "call the dentist" },
    { id: "b", text: "buy oat milk" },
    { id: "c", text: "milk, milk and more milk" },
  ];
  assert.deepEqual(search("milk", notes).map((n) => n.id), ["c", "b"]);
  assert.equal(search("dairy", notes).length, 0);
  assert.equal(search("  ", notes), notes);
});

test("the page a note was saved from is searchable too", () => {
  const notes = [{ id: "a", text: "read section 3 again", page: { url: "https://arxiv.org/abs/2202.03286", title: "Red Teaming Language Models" } }];
  assert.equal(search("red teaming", notes).length, 1);
  assert.equal(noteText(notes[0]), "read section 3 again\nRed Teaming Language Models");
});

// store.js

test("right-click saves a quote, or the page itself, with its address as text", () => {
  const tab = { url: "https://arxiv.org/abs/2212.08073", title: "Constitutional AI: Harmlessness from AI Feedback" };
  const quote = noteFromPage("save", { selectionText: " we train a harmless assistant " }, tab);
  assert.equal(quote.text, "we train a harmless assistant\narxiv.org/abs/2212.08073");
  assert.deepEqual(quote.page, tab);
  const page = noteFromPage("save-page", { pageUrl: tab.url }, tab);
  assert.equal(page.text, `${tab.title}\narxiv.org/abs/2212.08073`);
  // No tab details: fall back to the address Chrome sends with the click.
  assert.equal(noteFromPage("save-page", { pageUrl: "https://example.com/" }, undefined).text, "example.com");
  assert.equal(noteFromPage("save", { selectionText: "  " }, tab), null);
});

test("v1 HTML becomes plain text", () => {
  const html = 'buy milk<br>and eggs &amp; bread<button style="position: absolute;">X</button><button>X</button>';
  assert.equal(v1ToText(html), "buy milk\nand eggs & bread");
  // How v1's editable notes stored lines: the first bare, the rest in <div>s.
  assert.equal(v1ToText("line one<div>line two</div><div>line three</div>"), "line one\nline two\nline three");
  assert.equal(v1ToText("<div>first</div><div>second</div>"), "first\nsecond");
  assert.equal(v1ToText("above<div><br></div><div>below</div>"), "above\n\nbelow"); // a blank line stays one blank line
});

test("v1 migration keeps order and duplicates, skips blanks and notes already moved", () => {
  const existing = [makeNote("already here")];
  const notes = migrateV1(existing, JSON.stringify(["one<button>X</button>", "already here", "", "two", "two"]));
  assert.deepEqual(notes.map((n) => n.text), ["already here", "one", "two", "two"]);
  assert.equal(migrateV1(existing, "not json"), existing);
});
