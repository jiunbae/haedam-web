// 레시피 링크 v1 왕복 테스트. 의존성 없이 실행해요: node scripts/test_recipe.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

// 브라우저와 같은 조건으로 recipe.js를 불러와요 (window 없이 globalThis에 붙어요).
const ctx = vm.createContext({ TextEncoder, TextDecoder, btoa, atob });
vm.runInContext(read("assets/recipe.js"), ctx, { filename: "recipe.js" });
const R = ctx.HaedamRecipe;

const b64url = (obj) => Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
const plain = (o) => JSON.parse(JSON.stringify(o));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message.split("\n").join("\n       ")); }
}

console.log("recipe.js");
test("파라미터 67개, 키 중복 없음", () => {
  assert.equal(R.PARAMS.length, 67);
  assert.equal(new Set(R.PARAMS.map((p) => p.key)).size, 67);
});

const src = JSON.parse(read("community/recipes.src.json"));
const feed = JSON.parse(read("community/feed.json"));

console.log("feed.json (" + feed.recipes.length + "개)");
test("feed 형식", () => {
  assert.equal(feed.version, 1);
  assert.match(feed.updated, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(feed.updated, src.updated);
  assert.equal(feed.recipes.length, src.recipes.length);
  for (const r of feed.recipes) {
    for (const k of ["id", "name", "author", "summary", "tags", "accent", "payload"]) assert.ok(k in r, r.id + " 에 " + k + " 없음");
    assert.match(r.accent, /^#[0-9A-Fa-f]{6}$/);
    assert.match(r.payload, /^[A-Za-z0-9_-]+$/, "base64url 아님 / 패딩 포함");
  }
});

for (const s of src.recipes) {
  const entry = feed.recipes.find((r) => r.id === s.id);
  test(`${s.id} (${s.name}) 디코드 = 원본`, () => {
    assert.ok(entry, "feed 에 없음");
    const d = R.decode(entry.payload);
    assert.equal(d.name, s.name);
    assert.equal(d.keepCast, s.keepCast);
    const expected = Object.fromEntries(Object.entries(s.params).filter(([, v]) => v !== 0));
    assert.deepEqual(plain(d.params), expected);
  });
  test(`${s.id} JS 인코드 = Python payload`, () => {
    assert.equal(R.encode({ name: s.name, keepCast: s.keepCast, params: s.params }), entry.payload);
  });
}

console.log("엣지 케이스");
test("한국어·이모지 이름 왕복", () => {
  const name = "비 오는 날의 \"작은\" 산책 ☔︎ 🌧";
  const p = R.encode({ name, keepCast: 0.25, params: { "hsl.magenta.lum": -3, midHue: 300, midSat: 12, "curve.green.2": 5 } });
  assert.match(p, /^[A-Za-z0-9_-]+$/);
  const d = R.decode(p);
  assert.equal(d.name, name);
  assert.equal(d.keepCast, 0.25);
  assert.deepEqual(plain(d.params), { "curve.green.2": 5, midHue: 300, midSat: 12, "hsl.magenta.lum": -3 });
  // Node 표준 base64url 디코더로도 같은 JSON이 나와야 해요.
  assert.equal(JSON.parse(Buffer.from(p, "base64url").toString("utf8")).n, name);
});
test("Node Buffer로 만든 payload 디코드", () => {
  const d = R.decode(b64url({ v: 1, n: "동네 산책", k: 0.3, p: { grain: 16 } }));
  assert.equal(d.name, "동네 산책");
  assert.deepEqual(plain(d.params), { grain: 16 });
});
test("지원하지 않는 버전 거부", () => {
  assert.throws(() => R.decode(b64url({ v: 2, n: "x", k: 0, p: {} })), /버전/);
  assert.throws(() => R.decode(b64url({ n: "x", k: 0, p: {} })), /버전/);
  assert.throws(() => R.decode(b64url({ v: "1", n: "x", k: 0, p: {} })), /버전/);
});
test("범위 밖 값은 잘라내고, 알 수 없는 키는 무시", () => {
  const d = R.decode(b64url({ v: 1, n: "c", k: 3, p: {
    exposure: 250, warmth: -400, shadowHue: 720, midHue: -5, grain: -10, fade: 140,
    contrast: 7.6, bogus: 50, "hsl.pink.hue": 10, sharpness: "12", vignette: 0
  } }));
  assert.equal(d.keepCast, 1);
  assert.deepEqual(plain(d.params), { exposure: 100, contrast: 8, warmth: -100, shadowHue: 359, fade: 100 });
});
test("keepCast 음수 → 0", () => {
  assert.equal(R.decode(b64url({ v: 1, n: "c", k: -1, p: {} })).keepCast, 0);
});
test("잘못된 payload 거부", () => {
  for (const bad of ["", "###", "abc$", "a", "bm90IGpzb24", b64url([1, 2]), b64url({ v: 1, n: "x", k: 0, p: [1] })]) {
    assert.throws(() => R.decode(bad), undefined, JSON.stringify(bad));
  }
  // 잘못된 UTF-8
  assert.throws(() => R.decode(Buffer.from([0xff, 0xfe, 0x7b]).toString("base64url")));
});
test("'#' 접두어와 공백 허용", () => {
  const p = R.encode({ name: "아침", keepCast: 0.3, params: { exposure: 8 } });
  assert.equal(R.decode("#" + p + " ").name, "아침");
});
test("그룹 라벨", () => {
  const g = R.grouped({ exposure: 8, "hsl.aqua.sat": -15, "curve.master.0": 8, balance: -10, grainSize: 30 });
  assert.deepEqual(plain(g.map((x) => x.label)), ["기본", "HSL", "커브", "그레이딩", "필름"]);
  assert.deepEqual(plain(g.map((x) => x.rows[0].label)), ["노출", "청록 채도", "RGB 점1", "균형", "입자 크기"]);
});
test("영어 라벨 (영어 페이지)", () => {
  const g = R.grouped({ exposure: 8, "hsl.aqua.sat": -15, "curve.master.0": 8, balance: -10, grainSize: 30 }, "en");
  assert.deepEqual(plain(g.map((x) => x.label)), ["Basics", "HSL", "Curves", "Grading", "Film"]);
  assert.deepEqual(plain(g.map((x) => x.rows[0].label)), ["Exposure", "Aqua saturation", "RGB point 1", "Balance", "Grain size"]);
  assert.ok(R.PARAMS.every((p) => typeof p.labelEn === "string" && /^[\x20-\x7e]+$/.test(p.labelEn)), "모든 항목에 영어 라벨");
});
test("이름만 바꾸기 (영어 커뮤니티 링크)", () => {
  const feed = JSON.parse(read("community/feed.json"));
  for (const r of feed.recipes) {
    const p = R.rename(r.payload, r.en.name);
    const a = R.decode(r.payload), b = R.decode(p);
    assert.equal(b.name, r.en.name);
    assert.deepEqual(plain(b.params), plain(a.params));
    assert.equal(b.keepCast, a.keepCast);
  }
  assert.throws(() => R.rename("!!", "x"));
});
test("오류 code", () => {
  assert.throws(() => R.decode(""), (e) => e.code === "empty");
  assert.throws(() => R.decode(b64url({ v: 2, n: "x", k: 0, p: {} })), (e) => e.code === "version");
  assert.throws(() => R.decode(b64url([1])), (e) => e.code === "invalid");
  assert.throws(() => R.decode("a"), (e) => e.code === "unreadable");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
