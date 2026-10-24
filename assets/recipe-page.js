(function () {
  "use strict";
  var R = window.HaedamRecipe;
  var $ = function (id) { return document.getElementById(id); };
  // The English page (/en/r/) sets lang="en" and tells the script where the site root and feed
  // are; the Korean page (/r/) uses the defaults below.
  var EN = /^en\b/i.test(document.documentElement.lang || "");
  var cfg = (document.currentScript && document.currentScript.dataset) || {};
  var ROOT = cfg.root || "../";
  var FEED = cfg.feed || "../community/feed.json";
  var T = EN ? {
    again: ". Ask the person who sent it for the link again.", cantOpen: "Can't open this style — Haedam",
    slow: "The preview is taking a while. Please pick an example photo again.",
    noBrowser: "This browser couldn't make a preview.",
    noPreview: "Couldn't load the preview. Please pick an example photo again.",
    done: "Done ", timing: ["Done ", "ms (photo ", " bitmap ", " wait ", " pixels ", " render ", ")"],
    alt: " style on a photo", applying: "Applying style",
    noPhoto: "Couldn't load the photo or preview. Please pick again.", example: "Example",
    emptyTitle: "This style link is empty", emptyMsg: "There's no style information after the address",
    titleSuffix: " — Haedam style",
    meta: function (n, k) { return n + (n === 1 ? " adjustment" : " adjustments") + " · Keeps " + k + "% of the original color"; },
    none: "This style adds no adjustments of its own. The examples show the basic correction Haedam fits to each photo.",
    copied: "Link copied", copyFailed: "Couldn't copy the link"
  } : {
    again: ". 보내준 사람에게 링크를 다시 받아보세요.", cantOpen: "스타일을 열 수 없어요 — 해담",
    slow: "미리보기가 지연돼요. 예시 사진을 다시 골라주세요.",
    noBrowser: "이 브라우저에서는 미리보기를 만들지 못했어요.",
    noPreview: "미리보기를 불러오지 못했어요. 예시 사진을 다시 골라주세요.",
    done: "완료 ", timing: ["완료 ", "ms (사진 ", " 비트맵 ", " 대기 ", " 픽셀 ", " 렌더 ", ")"],
    alt: " 스타일을 입힌 사진", applying: "스타일 입히는 중",
    noPhoto: "사진이나 미리보기를 불러오지 못했어요. 다시 골라주세요.", example: "예시",
    emptyTitle: "스타일 링크가 비어 있어요", emptyMsg: "주소 뒤에 스타일 정보가 없어요",
    titleSuffix: " — 해담 스타일",
    meta: function (n, k) { return "조정한 항목 " + n + "개 · 원래 색 유지 " + k + "%"; },
    none: "추가한 조정 값이 없어요. 예시에는 사진에 맞춘 기본 보정이 적용돼요.",
    copied: "링크를 복사했어요", copyFailed: "복사하지 못했어요"
  };
  // recipe.js throws Korean messages with a code; English swaps them by code.
  var ERRORS_EN = {
    empty: "The link is empty", long: "This style link is too long", unreadable: "The link can't be read",
    format: "The link can't be read", invalid: "The style data isn't valid", version: "This style version isn't supported"
  };
  function errorText(e) { return EN ? ERRORS_EN[e && e.code] || "The link can't be read" : e.message; }

  function fmt(row) {
    if (row.hue) return row.value + "°";
    return (row.value > 0 ? "+" : "") + row.value;
  }

  function showError(msg) {
    $("view").hidden = true;
    $("error").hidden = false;
    if (msg) $("error-msg").textContent = msg + T.again;
    document.title = T.cantOpen;
  }

  // --- live preview: the recipe on example photos, drawn by render.js in a worker ---
  var SAMPLES = EN ? [
    { id: "walk", label: "Tree-lined street" }, { id: "cafe", label: "Coffee" }, { id: "dinner", label: "Dinner table" },
    { id: "river-sunset", label: "Sunset" }, { id: "green-forest", label: "Forest" }, { id: "night-walk", label: "Night blossoms" }
  ] : [
    { id: "walk", label: "가로수길" }, { id: "cafe", label: "커피" }, { id: "dinner", label: "식탁" },
    { id: "river-sunset", label: "노을" }, { id: "green-forest", label: "숲" }, { id: "night-walk", label: "밤벚꽃" }
  ];
  var worker = null, job = 0, current = null, previewGeneration = 0;
  var working = false, pending = null, watchdog = null, started = 0;

  function pixels(img, w, h) {
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    var ctx = c.getContext("2d", { willReadFrequently: true }); ctx.drawImage(img, 0, 0, w, h);
    var d = ctx.getImageData(0, 0, w, h).data, out = new Float32Array(w * h * 3);
    for (var i = 0, j = 0; i < d.length; i += 4, j += 3) { out[j] = d[i] / 255; out[j + 1] = d[i + 1] / 255; out[j + 2] = d[i + 2] / 255; }
    return out;
  }

  // After the first preview, fetch the other example photos quietly so switching skips
  // the network round trip (~250 ms to GitHub Pages from a phone). Skipped with Save-Data.
  var prefetched = false;
  function prefetchSamples() {
    if (prefetched) return;
    prefetched = true;
    if (navigator.connection && navigator.connection.saveData) return;
    SAMPLES.forEach(function (s) {
      var im = new Image();
      im.decoding = "async";
      if ("fetchPriority" in im) im.fetchPriority = "low";
      im.src = ROOT + "assets/photos/r/" + s.id + "-before.jpg";
    });
  }

  function loadImage(src) {
    return new Promise(function (ok, fail) {
      var im = new Image(), timer = setTimeout(function () { im.src = ""; fail(new Error("image timeout")); }, 15000);
      im.decoding = "async";
      im.onload = function () { clearTimeout(timer); ok(im); };
      im.onerror = function () { clearTimeout(timer); fail(new Error("image load")); };
      im.src = src;
    });
  }

  function discardPending() {
    if (pending && pending.data.bitmap) pending.data.bitmap.close();
    pending = null;
  }

  function previewError(message, id) {
    if (id != null && id !== job) return;
    $("shot").classList.remove("loading");
    $("pv-busy").hidden = false;
    $("pv-busy").classList.add("done");
    $("pv-busy-text").textContent = message;
  }

  function stopWorker() {
    clearTimeout(watchdog);
    if (worker) worker.terminate();
    worker = null; working = false; discardPending();
  }

  function send(data, transfers) {
    if (working) { discardPending(); pending = { data: data, transfers: transfers }; return; }
    working = true;
    watchdog = setTimeout(function () {
      stopWorker(); previewError(T.slow);
    }, 15000);
    try { worker.postMessage(data, transfers); }
    catch (error) { if (data.bitmap) data.bitmap.close(); stopWorker(); previewError(T.noBrowser); }
  }

  function ensureWorker() {
    if (worker) return;
    worker = new Worker(ROOT + "assets/render-worker.js");
    var active = worker;
    worker.onerror = worker.onmessageerror = function () {
      if (worker !== active) return;
      stopWorker(); previewError(T.noPreview);
    };
    worker.onmessage = function (e) {
      if (worker !== active) return;
      clearTimeout(watchdog); working = false;
      if (e.data.id === job) {
        // The worker's message is Korean; English shows its own.
        if (e.data.error) previewError(EN ? T.noPreview : e.data.error, e.data.id);
        else {
          var canvas = $("pv-canvas"), shot = $("shot");
          canvas.getContext("2d").putImageData(new ImageData(e.data.rgba, e.data.w, e.data.h), 0, 0);
          shot.classList.remove("loading");
          void canvas.offsetWidth;
          canvas.classList.add("reveal"); canvas.style.clipPath = "inset(0 0 0 0)";
          prefetchSamples();
          if (/[?&]timing=1/.test(location.search)) {
            $("pv-busy").classList.add("done");
            $("pv-busy-text").textContent = T.done + Math.round(performance.now() - started) + "ms";
            // Plain text too: Safari doesn't expose role=status contents to UI tests.
            var t = $("pv-timing") || document.body.appendChild(Object.assign(document.createElement("p"), { id: "pv-timing", className: "timing" }));
            var w = e.data.timing || {};
            var L = T.timing;
            t.textContent = L[0] + Math.round(performance.now() - started) + L[1] + Math.round(marks.img - started) +
              L[2] + Math.round(marks.bitmap - marks.img) + L[3] + Math.round(performance.now() - marks.sent - (w.pixels || 0) - (w.render || 0)) +
              L[4] + w.pixels + L[5] + w.render + L[6];
          } else $("pv-busy").hidden = true;
        }
      }
      if (pending) { var next = pending; pending = null; send(next.data, next.transfers); }
    };
  }

  var marks = {};  // ?timing=1 breakdown
  function showSample(sample, recipe) {
    var id = ++job;
    discardPending();
    document.querySelectorAll("#samples button").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.id === sample.key ? "true" : "false"); });
    var before = $("pv-before"), after = $("pv-after"), canvas = $("pv-canvas"), base = $("pv-base"), shot = $("shot");
    before.src = ROOT + "assets/photos/r/" + sample.id + "-before.jpg";
    base.src = before.src;
    shot.classList.remove("show-before"); shot.setAttribute("aria-pressed", "false");
    if (sample.prerendered) {
      stopWorker();
      after.src = ROOT + sample.prerendered; after.alt = recipe.name + T.alt; after.hidden = false;
      canvas.hidden = true; base.hidden = true; $("pv-busy").hidden = true; shot.classList.remove("loading");
      return;
    }
    after.hidden = true; canvas.hidden = false; base.hidden = false; $("pv-busy").hidden = false;
    $("pv-busy-text").textContent = T.applying; $("pv-busy").classList.remove("done");
    if ($("pv-timing")) $("pv-timing").textContent = "";
    shot.classList.add("loading");
    canvas.classList.remove("reveal"); canvas.style.clipPath = "inset(0 100% 0 0)";
    started = performance.now();
    loadImage(before.src).then(async function (img) {
      if (id !== job) return;
      marks.img = performance.now();
      ensureWorker();
      var data = { id: id, key: sample.id, w: 540, h: 675, sw: 205, sh: 256, params: recipe.params, keepCast: recipe.keepCast };
      var bitmap = window.createImageBitmap ? await createImageBitmap(img) : null;
      if (id !== job) { if (bitmap) bitmap.close(); return; }
      marks.bitmap = marks.sent = performance.now();
      if (window.OffscreenCanvas && bitmap) {
        data.bitmap = bitmap;
        send(data, [bitmap]);
      } else {
        try { data.px = pixels(bitmap || img, 540, 675); data.small = pixels(bitmap || img, 205, 256); }
        finally { if (bitmap) bitmap.close(); }
        send(data, [data.px.buffer, data.small.buffer]);
      }
    }).catch(function () { previewError(T.noPhoto, id); });
  }

  function preview(recipe, payload) {
    current = recipe;
    var generation = ++previewGeneration;
    ++job; stopWorker();  // Hash changes cannot publish an old recipe or queued work.
    // Warm only the tiny first job; no large source arrays are copied.
    if (window.Worker) {
      try {
        ensureWorker();
        var warm = new Float32Array(64 * 80 * 3).fill(0.5);
        send({ id: -1, key: "warm", px: warm, small: warm, w: 64, h: 80, sw: 64, sh: 80,
          params: recipe.params, keepCast: recipe.keepCast }, [warm.buffer]);
      } catch (error) { stopWorker(); }
    }
    var box = $("samples"), list = SAMPLES.map(function (s) { return { key: s.id, id: s.id, label: s.label }; });
    function draw() {
      if (generation !== previewGeneration) return;
      box.textContent = "";
      list.forEach(function (s) {
        var b = document.createElement("button"); b.type = "button"; b.textContent = s.label; b.dataset.id = s.key;
        b.addEventListener("click", function () { showSample(s, current); });
        box.appendChild(b);
      });
      showSample(list[0], recipe);
    }
    // A community recipe starts on its own example photo (already rendered).
    var controller = new AbortController();
    var feedTimer = setTimeout(function () { controller.abort(); }, 2500);
    fetch(FEED, { signal: controller.signal }).then(function (res) { if (!res.ok) throw new Error("feed"); return res.json(); }).then(function (feed) {
      // English community links carry the English name, so match those too.
      var enName = function (r) { return EN && r && r.en && typeof r.en.name === "string" && r.en.name ? r.en.name : ""; };
      var hit = (feed.recipes || []).filter(function (r) {
        if (r.payload === payload) return true;
        try { return !!enName(r) && typeof r.payload === "string" && R.rename(r.payload, enName(r)) === payload; } catch (e) { return false; }
      })[0];
      if (generation === previewGeneration && enName(hit)) {
        // Show an official style by its English name and open it in the app under that name.
        recipe.name = enName(hit);
        $("name").textContent = recipe.name;
        document.title = recipe.name + T.titleSuffix;
        try { $("open-app").href = "haedam://recipe#" + R.rename(payload, recipe.name); } catch (e) {}
        // The Korean page knows the official style by its original link.
        langLink(hit.payload);
      }
      var ok = function (p) { return typeof p === "string" && /^assets\/photos\/r\/[a-z0-9-]+\.jpg$/.test(p); };
      if (generation === previewGeneration && hit && ok(hit.image) && typeof hit.id === "string" && /^[a-z0-9-]+$/.test(hit.id)) {
        list = list.filter(function (s) { return s.id !== hit.id; });
        list.unshift({ key: "own", id: hit.id, label: T.example, prerendered: hit.image });
      }
    }).catch(function () {}).then(function () { clearTimeout(feedTimer); draw(); });
  }

  // The language switch keeps the style: carry the link's payload over to the other page.
  function langLink(payload) {
    var a = $("lang");
    if (a) a.setAttribute("href", a.getAttribute("href").split("#")[0] + (payload ? "#" + payload : ""));
  }

  function holdToCompare(node) {
    function on() { node.classList.add("show-before"); node.setAttribute("aria-pressed", "true"); }
    function off() { node.classList.remove("show-before"); node.setAttribute("aria-pressed", "false"); }
    node.addEventListener("pointerdown", on);
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (t) { node.addEventListener(t, off); });
    node.addEventListener("keydown", function (e) { if (e.key === " " || e.key === "Enter") { e.preventDefault(); on(); } });
    node.addEventListener("keyup", off);
    node.addEventListener("blur", off);
    node.addEventListener("click", function (e) { if (e.detail === 0) { if (node.classList.contains("show-before")) off(); else on(); } });
    node.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }
  holdToCompare($("shot"));

  function render() {
    ++previewGeneration; ++job; stopWorker();
    var payload = location.hash.replace(/^#/, "");
    langLink(payload);
    if (!payload) {
      $("error-title").textContent = T.emptyTitle;
      showError(T.emptyMsg);
      return;
    }
    var recipe;
    try { recipe = R.decode(payload); } catch (e) { showError(errorText(e)); return; }
    if (EN && recipe.name === R.UNNAMED) recipe.name = "Untitled style";

    $("error").hidden = true;
    $("view").hidden = false;
    $("name").textContent = recipe.name;
    document.title = recipe.name + T.titleSuffix;

    var count = Object.keys(recipe.params).length;
    $("meta").textContent = T.meta(count, Math.round(recipe.keepCast * 100));
    preview(recipe, payload);
    $("open-app").href = "haedam://recipe#" + payload;

    var box = $("groups");
    box.textContent = "";
    var groups = R.grouped(recipe.params, EN ? "en" : undefined);
    if (!groups.length) {
      var empty = document.createElement("div");
      empty.className = "card note";
      empty.textContent = T.none;
      box.appendChild(empty);
    }
    groups.forEach(function (g) {
      var card = document.createElement("section");
      card.className = "card group";
      var h = document.createElement("h2");
      h.textContent = g.label;
      card.appendChild(h);
      var table = document.createElement("table");
      g.rows.forEach(function (row) {
        var tr = document.createElement("tr");
        var td1 = document.createElement("td");
        if (row.hue) {
          var dot = document.createElement("span");
          dot.className = "hue-dot";
          dot.style.background = "hsl(" + row.value + " 60% 60%)";
          td1.appendChild(dot);
        }
        td1.appendChild(document.createTextNode(row.label));
        var td2 = document.createElement("td");
        td2.className = "v " + (row.value > 0 ? "pos" : "neg");
        td2.textContent = fmt(row);
        tr.appendChild(td1);
        tr.appendChild(td2);
        table.appendChild(tr);
      });
      card.appendChild(table);
      box.appendChild(card);
    });
  }

  var toastTimer;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
    return ok;
  }

  $("copy").addEventListener("click", function () {
    var url = location.href;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(
        function () { toast(T.copied); },
        function () { toast(fallbackCopy(url) ? T.copied : T.copyFailed); }
      );
    } else {
      toast(fallbackCopy(url) ? T.copied : T.copyFailed);
    }
  });

  window.addEventListener("pagehide", stopWorker);
  window.addEventListener("pageshow", function (e) { if (e.persisted) render(); });
  window.addEventListener("hashchange", render);
  render();
})();
