// render.js가 Python 기준 구현(ml/haru_renderer.py)과 같은 결과를 내는지 확인해요.
// 기대값 다시 만들기: uv run --with numpy --with pillow python -I ml/gen_web_fixture.py <photo> web/scripts/render_fixture.json
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const R = require("../assets/render.js");
const fx = JSON.parse(readFileSync(new URL("./render_fixture.json", import.meta.url)));
const px = Float32Array.from(fx.input, v => v / 255);
let failed = 0;
for (const c of fx.cases) {
  const errors = [];
  if (c.id !== "stress") {
    const p = R.lookParams(px, fx.width, fx.height, c.delta, c.keepCast);
    for (const k of new Set([...Object.keys(p), ...Object.keys(c.params)])) {
      if ((p[k] || 0) !== (c.params[k] || 0)) errors.push(`${k}: ${p[k]} != ${c.params[k]}`);
    }
  }
  const out = R.render(px, fx.width, fx.height, c.params, c.intensity);
  let max = 0, sum = 0;
  for (let i = 0; i < out.length; i++) {
    const d = Math.abs(Math.floor(Math.min(1, Math.max(0, out[i])) * 255 + 0.5) - c.expected[i]);
    max = Math.max(max, d); sum += d;
  }
  const mean = sum / out.length;
  if (max > 2 || mean > 0.1) errors.push(`pixels: max ${max}, mean ${mean.toFixed(3)}`);
  console.log(`  ${errors.length ? "FAIL" : "ok  "} ${c.id.padEnd(15)} max ${max} mean ${mean.toFixed(3)}${errors.length ? "  " + errors.slice(0, 4).join("; ") : ""}`);
  if (errors.length) failed++;
}
console.log(`\n${fx.cases.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
