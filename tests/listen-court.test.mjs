import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(root, "listen-court/index.html"), "utf8");
const scriptMatch = page.match(/<script>([\s\S]*)<\/script>/);
assert.ok(scriptMatch, "listen-court player script missing");
const script = scriptMatch[1];

const PLACEHOLDER = "Select a scene or paste your own text here.";

function boot(voices) {
  const elements = {};
  const spoken = [];
  let constructed = 0;

  function createElement(tag) {
    const el = {
      tag,
      id: "",
      className: "",
      textContent: "",
      dataset: {},
      children: [],
      onclick: null,
      _classes: new Set(),
      _value: undefined,
      _html: "",
    };
    el.classList = {
      add(name) {
        el._classes.add(name);
      },
      remove(name) {
        el._classes.delete(name);
      },
      contains(name) {
        return el._classes.has(name);
      },
    };
    Object.defineProperty(el, "innerHTML", {
      get() {
        return el._html;
      },
      set(value) {
        el._html = String(value);
        if (el._html === "") {
          el.children.length = 0;
          if (el.id === "voice") el._value = undefined;
        }
      },
    });
    Object.defineProperty(el, "value", {
      get() {
        if (el._value !== undefined) return el._value;
        if (tag === "option") return el.textContent;
        return "";
      },
      set(value) {
        el._value = String(value);
      },
    });
    el.appendChild = (child) => {
      el.children.push(child);
      if (el.id === "voice" && (el._value === undefined || el._value === "") && child.value) {
        el._value = child.value;
      }
      return child;
    };
    return el;
  }

  for (const id of ["scenes", "transcript", "status", "play", "pause", "stop", "voice", "rate", "pitch", "volume"]) {
    elements[id] = createElement(id === "voice" ? "select" : "div");
    elements[id].id = id;
  }
  elements.transcript.textContent = PLACEHOLDER;
  elements.rate.value = "1";
  elements.pitch.value = "1";
  elements.volume.value = "1";

  const synth = {
    speaking: false,
    paused: false,
    cancels: 0,
    onvoiceschanged: null,
    getVoices() {
      return voices;
    },
    cancel() {
      this.speaking = false;
      this.paused = false;
      this.cancels += 1;
    },
    speak(utterance) {
      this.speaking = true;
      this.paused = false;
      spoken.push(utterance);
    },
    pause() {
      this.paused = true;
    },
    resume() {
      this.paused = false;
      this.speaking = true;
    },
  };

  class SpeechSynthesisUtterance {
    constructor(text) {
      constructed += 1;
      this.text = text;
      this.rate = 1;
      this.pitch = 1;
      this.volume = 1;
      this.voice = null;
      this.onstart = null;
      this.onend = null;
      this.onerror = null;
    }
  }

  const document = {
    getElementById(id) {
      return elements[id] ?? null;
    },
    createElement,
    querySelectorAll(selector) {
      if (selector === ".scene") return elements.scenes.children;
      return [];
    },
    querySelector(selector) {
      const match = selector.match(/^\.scene\[data-id="([\s\S]*)"\]$/);
      if (!match) return null;
      return elements.scenes.children.find((el) => el.dataset.id === match[1]) ?? null;
    },
  };

  vm.runInNewContext(script, {
    document,
    speechSynthesis: synth,
    SpeechSynthesisUtterance,
  });

  return {
    elements,
    synth,
    spoken,
    constructed: () => constructed,
  };
}

function activeIds(player) {
  return player.elements.scenes.children.filter((el) => el.classList.contains("active")).map((el) => el.dataset.id);
}

test("scene catalog is unique and safe to select", () => {
  const player = boot([]);
  const scenes = player.elements.scenes.children;
  const ids = scenes.map((el) => el.dataset.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 2);
  for (const el of scenes) {
    assert.match(el.dataset.id, /^[a-z0-9-]+$/);
    assert.ok(el.textContent.trim());
  }
  assert.deepEqual(activeIds(player), [ids[0]]);
  assert.equal(player.elements.status.textContent, scenes[0].textContent);
  assert.notEqual(player.elements.transcript.textContent, PLACEHOLDER);
  assert.ok(player.elements.transcript.textContent.trim());
});

test("placeholder guard matches the editable transcript", () => {
  const initial = page.match(/id="transcript"[^>]*>([^<]*)</);
  assert.ok(initial, "transcript placeholder missing");
  const guard = script.match(/text === "([^"]*)"/);
  assert.ok(guard, "speak() placeholder guard missing");
  assert.equal(initial[1], guard[1]);
  assert.equal(initial[1], PLACEHOLDER);
});

test("selecting a scene replaces the transcript and the active row", () => {
  const player = boot([]);
  const second = player.elements.scenes.children[1];
  second.onclick();
  assert.deepEqual(activeIds(player), [second.dataset.id]);
  assert.equal(player.elements.status.textContent, second.textContent);
  assert.equal(player.elements.transcript.textContent.trim().length > 0, true);
  assert.notEqual(player.elements.transcript.textContent, PLACEHOLDER);
});

test("voice list prefers English, then any voice, then Default", () => {
  const english = [
    { name: "French", lang: "fr-FR" },
    { name: "US", lang: "en-US" },
    { name: "British", lang: "en-GB" },
  ];
  const preferred = boot(english);
  assert.deepEqual(
    preferred.elements.voice.children.map((option) => option.value),
    ["US", "British"],
  );

  const frenchOnly = boot([{ name: "French", lang: "fr-FR" }]);
  assert.deepEqual(
    frenchOnly.elements.voice.children.map((option) => option.textContent),
    ["French (fr-FR)"],
  );

  const none = boot([]);
  assert.equal(none.elements.voice.children.length, 1);
  assert.equal(none.elements.voice.children[0].textContent, "Default");

  const upper = boot([{ name: "Upper", lang: "EN-us" }]);
  assert.equal(upper.elements.voice.children[0].textContent, "Upper (EN-us)");
});

test("speak refuses empty and placeholder text, and still cancels audio", () => {
  const player = boot([{ name: "US", lang: "en-US" }]);
  const before = player.constructed();

  player.elements.transcript.textContent = "   \n  ";
  player.elements.play.onclick();
  assert.equal(player.elements.status.textContent, "Nothing to speak");
  assert.equal(player.synth.cancels, 1);
  assert.equal(player.spoken.length, 0);
  assert.equal(player.constructed(), before);

  player.elements.transcript.textContent = `  ${PLACEHOLDER}  `;
  player.elements.play.onclick();
  assert.equal(player.elements.status.textContent, "Nothing to speak");
  assert.equal(player.spoken.length, 0);
  assert.equal(player.synth.cancels, 2);
});

test("speak maps the selected voice and slider values, including silence", () => {
  const us = { name: "US", lang: "en-US" };
  const player = boot([us, { name: "British", lang: "en-GB" }]);
  player.elements.voice.value = "British";
  player.elements.rate.value = "0.5";
  player.elements.pitch.value = "1.5";
  player.elements.volume.value = "0";
  player.elements.transcript.textContent = "  You have the conn.  ";

  player.elements.play.onclick();
  assert.equal(player.spoken.length, 1);
  const utterance = player.spoken[0];
  assert.equal(utterance.text, "You have the conn.");
  assert.equal(utterance.voice.name, "British");
  assert.equal(utterance.rate, 0.5);
  assert.equal(utterance.pitch, 1.5);
  assert.equal(utterance.volume, 0);
  assert.equal(player.synth.speaking, true);

  utterance.onstart();
  assert.equal(player.elements.status.textContent, "Speaking…");
  utterance.onend();
  assert.equal(player.elements.status.textContent, "Ready");
  utterance.onerror();
  assert.equal(player.elements.status.textContent, "Error");

  player.elements.voice.value = "Missing";
  player.elements.rate.value = "nope";
  player.elements.transcript.textContent = "Report.";
  player.elements.play.onclick();
  assert.equal(player.spoken[1].voice, null);
  assert.equal(Number.isNaN(player.spoken[1].rate), true);
  assert.equal(player.synth.cancels, 2);
});

test("pause toggles only while speaking, and stop cancels", () => {
  const player = boot([]);
  const status = () => player.elements.status.textContent;
  const initial = status();

  player.elements.pause.onclick();
  assert.equal(status(), initial);
  assert.equal(player.synth.paused, false);

  player.elements.play.onclick();
  player.elements.pause.onclick();
  assert.equal(player.synth.paused, true);
  assert.equal(status(), "Paused");
  player.elements.pause.onclick();
  assert.equal(player.synth.paused, false);
  assert.equal(status(), "Speaking…");

  player.elements.stop.onclick();
  assert.equal(player.synth.speaking, false);
  assert.equal(player.synth.cancels, 2);
  assert.equal(status(), "Stopped");

  player.elements.pause.onclick();
  assert.equal(status(), "Stopped");
});
