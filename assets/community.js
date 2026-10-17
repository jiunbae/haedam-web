(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var all = [];
  var activeTag = "";

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function validHex(c) { return /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#F0B88A"; }
  function validPayload(p) { return typeof p === "string" && /^[A-Za-z0-9_-]+$/.test(p); }

  function accentGradient(hex) {
    return "radial-gradient(120% 90% at 20% 15%, " + hex + " 0%, transparent 60%)," +
      "linear-gradient(150deg, " + hex + "cc 0%, " + hex + "55 45%, #1A1A1C 100%)";
  }

  function validImage(p) { return typeof p === "string" && /^assets\/photos\/[a-z0-9\/-]+\.jpg$/.test(p); }

  // WebP at 480/720 px with the JPEG as fallback; cards are ~330 px on desktop, full width on phones.
  function picture(path, img, deferred) {
    var pic = el("picture"), source = el("source"), base = "../" + path.replace(/\.jpg$/, "");
    source.type = "image/webp";
    if (deferred) source.dataset.srcset = base + "-480.webp 480w, " + base + ".webp 720w";
    else source.srcset = base + "-480.webp 480w, " + base + ".webp 720w";
    source.sizes = "(max-width: 760px) 92vw, 340px";
    pic.appendChild(source); pic.appendChild(img);
    return pic;
  }

  function loadBefore(node) {
    node.querySelectorAll("source[data-srcset]").forEach(function (s) { s.srcset = s.dataset.srcset; s.removeAttribute("data-srcset"); });
    node.querySelectorAll("img[data-src]").forEach(function (i) { i.src = i.dataset.src; i.removeAttribute("data-src"); });
  }

  function holdToCompare(node) {
    ["pointerenter", "pointerdown", "focusin"].forEach(function (t) { node.addEventListener(t, function () { loadBefore(node); }, { once: true }); });
    node.setAttribute("role", "button"); node.setAttribute("aria-pressed", "false");
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

  function card(r) {
    var a = el("article", "card r-card");
    if (validImage(r.image)) {
      var shot = el("div", "shot");
      shot.tabIndex = -1;
      shot.setAttribute("aria-label", r.name + " 보정 예시" + (validImage(r.imageBefore) ? ", 누르고 있으면 원본" : ""));
      var img = el("img"); img.src = "../" + r.image; img.alt = r.name + " 스타일을 입힌 사진"; img.loading = "lazy"; img.decoding = "async";
      img = picture(r.image, img);
      shot.appendChild(img);
      if (validImage(r.imageBefore)) {
        shot.tabIndex = 0;
        // The original is only seen while pressing, so fetch it on the first hover/press/focus.
        var before = el("img", "before"); before.dataset.src = "../" + r.imageBefore; before.alt = ""; before.decoding = "async";
        before = picture(r.imageBefore, before, true);
        shot.appendChild(before);
        shot.appendChild(el("span", "hint", "누르고 있으면 원본"));
        holdToCompare(shot);
      }
      if (r.photoCredit) shot.appendChild(el("span", "credit", "사진 " + r.photoCredit));
      a.appendChild(shot);
    } else {
      var sw = el("div", "swatch");
      sw.style.background = accentGradient(validHex(r.accent));
      sw.setAttribute("aria-hidden", "true");
      a.appendChild(sw);
    }

    var b = el("div", "body");
    b.appendChild(el("h3", null, r.name));
    b.appendChild(el("span", "author", r.author));
    b.appendChild(el("p", "summary", r.summary));
    var tags = el("div", "tags");
    (r.tags || []).forEach(function (t) { tags.appendChild(el("span", null, "#" + t)); });
    b.appendChild(tags);

    var row = el("div", "btn-row");
    var get = el("a", "btn btn-accent btn-sm", "앱으로 받기");
    get.href = "haedam://recipe#" + r.payload;
    var more = el("a", "btn btn-sm", "자세히");
    more.href = "../r/#" + r.payload;
    row.appendChild(get);
    row.appendChild(more);
    b.appendChild(row);
    a.appendChild(b);
    return a;
  }

  function matches(r, q) {
    if (activeTag && (r.tags || []).indexOf(activeTag) < 0) return false;
    if (!q) return true;
    var hay = [r.name, r.author, r.summary].concat(r.tags || []).join(" ").toLowerCase();
    return q.split(/\s+/).every(function (w) { return hay.indexOf(w.replace(/^#/, "")) >= 0; });
  }

  function render() {
    var q = $("q").value.trim().toLowerCase();
    var list = all.filter(function (r) { return matches(r, q); });
    var feed = $("feed");
    feed.textContent = "";
    list.forEach(function (r) { feed.appendChild(card(r)); });
    var st = $("status");
    st.hidden = list.length > 0;
    st.textContent = "찾는 스타일이 없어요. 다른 단어로 찾아보세요.";
  }

  function renderChips() {
    var counts = {};
    all.forEach(function (r) { (r.tags || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
    var tags = Object.keys(counts).sort(function (x, y) { return counts[y] - counts[x] || x.localeCompare(y, "ko"); });
    var box = $("chips");
    box.textContent = "";
    [""].concat(tags).forEach(function (t) {
      var c = el("button", "chip", t ? "#" + t : "전체");
      c.type = "button";
      c.setAttribute("aria-pressed", String(t === activeTag));
      c.addEventListener("click", function () {
        activeTag = t;
        Array.prototype.forEach.call(box.children, function (n) { n.setAttribute("aria-pressed", "false"); });
        c.setAttribute("aria-pressed", "true");
        render();
      });
      box.appendChild(c);
    });
  }

  $("q").addEventListener("input", render);

  fetch("./feed.json", { cache: "no-cache" })
    .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
    .then(function (data) {
      if (!data || data.version !== 1 || !Array.isArray(data.recipes)) throw new Error("bad feed");
      all = data.recipes.filter(function (r) { return r && typeof r.name === "string" && validPayload(r.payload) && r.payload.length <= 16384; })
        .map(function (r) { return Object.assign({}, r, { tags: Array.isArray(r.tags) ? r.tags.filter(function (t) { return typeof t === "string"; }) : [] }); });
      if (data.updated) $("updated").textContent = "© 2026 해담 · " + data.updated + " 업데이트";
      renderChips();
      render();
    })
    .catch(function () {
      $("status").textContent = "스타일을 불러오지 못했어요. 잠시 후 다시 열어주세요.";
    });
})();
