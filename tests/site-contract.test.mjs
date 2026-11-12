import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("briefing manifest, page, and audio files name the same copies", () => {
  const manifest = JSON.parse(read("briefings/audio/manifest.json"));
  const page = read("briefings/index.html");
  const ids = manifest.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(manifest.length > 0);

  const names = manifest.map((item) => {
    assert.ok(item.title);
    assert.ok(item.note);
    assert.match(item.src, /^\/audio\/[^/]+\.mp3$/);
    const name = item.src.slice("/audio/".length);
    const file = statSync(join(root, "briefings/audio", name));
    assert.ok(file.isFile());
    assert.ok(file.size > 0, name);
    assert.ok(page.includes(`src="audio/${name}"`), name);
    assert.ok(page.includes(item.title), item.title);
    assert.ok(page.includes(item.note), item.note);
    return name;
  });

  const embedded = [...page.matchAll(/<audio[^>]*\ssrc="audio\/([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(embedded, names);
});

test("new public pages keep their relative links", () => {
  const landing = read("index.html");
  const briefings = read("briefings/index.html");
  const recovery = read("recovery/index.html");
  assert.ok(landing.includes('href="briefings/"'));
  assert.ok(landing.includes('href="recovery/"'));
  assert.ok(briefings.includes('href="../recovery/"'));
  assert.ok(recovery.includes('href="../"'));
  assert.ok(statSync(join(root, "favicon.svg")).size > 0);
  assert.ok(read("recovery/index.html").includes("Do not force-push."));
});

test("published prices and the email check stay internally consistent", () => {
  const src = read("index.html");
  const plansAt = src.indexOf("const plans = [");
  const plansEnd = src.indexOf("];", plansAt);
  const plans = new Function(`${src.slice(plansAt, plansEnd + 2)}\nreturn plans;`)();
  assert.deepEqual(
    plans.map((plan) => [plan.id, plan.monthly, plan.yearly]),
    [
      ["starter", 0, 0],
      ["team", 12, 10],
      ["scale", 28, 22],
    ],
  );

  const eight = src.match(/Eight people is \$\{money\((.+)\)\} a month/);
  assert.ok(eight, "team seat total expression missing");
  const team = plans.find((plan) => plan.id === "team");
  const total = (yearly) => new Function("yearly", `return ${eight[1]};`)(yearly);
  assert.equal(total(true), team.yearly * 8);
  assert.equal(total(false), team.monthly * 8);

  const escAt = src.indexOf("function esc(");
  const escEnd = src.indexOf("function renderBoard(");
  const esc = new Function(`${src.slice(escAt, escEnd)}\nreturn esc;`)();
  assert.equal(esc(`A & B <script>"'`), "A &amp; B &lt;script&gt;&quot;&#39;");

  const email = src.match(/if \(!(\/[^/\n]+\/)\.test\(email\)\)/);
  assert.ok(email, "email check missing");
  const accepts = new Function("email", `return ${email[1]}.test(email);`);
  assert.equal(accepts("you@company.com"), true);
  assert.equal(accepts("you@company"), false);
  assert.equal(accepts("you @company.com"), false);
  assert.equal(accepts("you@company.com extra"), false);
});
