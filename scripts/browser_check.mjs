// 브라우저 점검: 페이지 오류·CSP 위반, WebP 사용, 전송량, 원본 지연 로딩, 레시피 미리보기 완료.
// 사용: PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs node web/scripts/browser_check.mjs [web 폴더]
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT || "playwright");
const root = path.resolve(process.argv[2] || new URL("..", import.meta.url).pathname);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".jpg": "image/jpeg",
  ".webp": "image/webp", ".png": "image/png", ".json": "application/json" };
let bytes = 0;
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0].split("#")[0]); if (p.endsWith("/")) p += "index.html";
  try { const b = await readFile(path.join(root, p)); bytes += b.length; res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}`;
const recipe = Buffer.from(JSON.stringify({ v: 1, n: "점검 레시피", k: 0.4, p: { warmth: 18, contrast: 12, fade: 20, grain: 20, grainSize: 40 } }))
  .toString("base64url");
const pages = [
  ["landing", "/", { width: 390, height: 844 }],
  ["community", "/community/", { width: 1280, height: 900 }],
  ["community-mobile", "/community/", { width: 390, height: 844 }],
  ["recipe", "/r/?timing=1#" + recipe, { width: 390, height: 844 }],
  ["privacy", "/privacy/", { width: 390, height: 844 }],
];
const browser = await chromium.launch();
let failed = 0;
try {
  for (const [name, url, vp] of pages) {
    const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => (m.type() === "error" || /Content Security/.test(m.text())) && errors.push(m.text()));
    bytes = 0;
    await page.goto(base + url, { waitUntil: "networkidle" });
    let extra = "";
    if (name === "recipe") {
      await page.waitForFunction(() => /완료/.test(document.getElementById("pv-busy-text").textContent), null, { timeout: 20000 });
      extra = await page.textContent("#pv-busy-text");
    }
    const deferred = await page.evaluate(() => document.querySelectorAll(".shot img.before[data-src]").length);
    if (deferred) {
      const shot = page.locator(".shot").first(); await shot.scrollIntoViewIfNeeded(); await shot.hover(); await page.mouse.down();
      await page.waitForTimeout(800);
      const ok = await page.evaluate(() => { const b = document.querySelector(".shot .before"); return b.complete && b.naturalWidth > 0; });
      await page.mouse.up();
      if (!ok) errors.push("original did not load on press");
      extra += " original-on-press ok";
    }
    const webp = await page.evaluate(() => [...document.images].filter(i => i.currentSrc.endsWith(".webp")).length + "/" + document.images.length);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) errors.push("horizontal overflow");
    console.log(`${errors.length ? "FAIL" : "ok  "} ${name.padEnd(17)} ${Math.round(bytes / 1024)} KB  webp ${webp} ${extra} ${errors.slice(0, 2).join(" | ")}`);
    if (errors.length) failed++;
    await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(`\n${pages.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
