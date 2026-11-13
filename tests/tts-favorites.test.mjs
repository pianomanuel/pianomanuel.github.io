import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const publishedTitles = [
  "The Drop — Book One",
  "The Hold — Book Two",
  "The Thought That Stays — Chapter Two",
  "After the Hold — quiet continuation",
  "Robert Mind Surrender (TTS-001)",
  "Castle L3 L4 (TTS-002)",
];

test("the public favorites page lists titles and leaves chapter source private", () => {
  const page = read("tts-favorites.html");
  const lists = page.match(/<ol>[\s\S]*?<\/ol>/g) ?? [];
  assert.equal(lists.length, 1);
  assert.equal(page.includes("<ul>"), false);

  const items = [...lists[0].matchAll(/<li>([^<]*)<\/li>/g)].map((match) => match[1]);
  assert.deepEqual(items, publishedTitles);
  assert.equal(new Set(items).size, items.length);
  for (const item of items) {
    assert.equal(item, item.trim());
    assert.ok(item.length > 0 && item.length <= 80, item);
  }

  assert.match(page, /Source of truth remains private\./);
  assert.equal(page.includes("<script"), false);
  assert.doesNotMatch(page, /\son[a-z]+=/i);
  assert.doesNotMatch(page, /\b(?:src|href)\s*=/i);
  assert.doesNotMatch(page, /https?:|mailto:|localStorage|fetch\(|SpeechSynthesis/i);
  assert.doesNotMatch(page, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

  const court = read("listen-court/index.html");
  const spoken = [...court.matchAll(/text:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(spoken.length >= publishedTitles.length);
  for (const line of spoken) {
    assert.equal(page.includes(line), false, line);
  }
});
