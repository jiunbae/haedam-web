(function () {
  var range = document.getElementById("compare-range");
  var before = document.getElementById("compare-before");
  var handle = document.getElementById("compare-handle");
  var after = document.getElementById("compare-after");
  var name = document.getElementById("compare-name");
  function setPos() {
    var v = range.value + "%";
    before.style.clipPath = "inset(0 calc(100% - " + v + ") 0 0)";
    handle.style.left = v;
  }
  range.addEventListener("input", setPos);
  setPos();
  var cache = {};
  // Photo folder relative to this page (assets/photos/ or ../assets/photos/), taken from the hero image itself.
  var photoDir = after.getAttribute("src").replace(/[^\/]*$/, "");
  var en = /^en\b/.test(document.documentElement.lang);
  document.querySelectorAll(".chips button").forEach(function (b) {
    var src = photoDir + "hero-" + b.dataset.look + ".jpg";
    var webpSet = src.replace(/\.jpg$/, "-640.webp") + " 640w, " + src.replace(/\.jpg$/, ".webp") + " 960w";
    function preload() {
      if (cache[b.dataset.look]) return;
      var img = new Image();  // same candidates as the <source>, so the browser reuses the download
      img.sizes = "(max-width: 760px) 320px, 480px"; img.srcset = webpSet;
      cache[b.dataset.look] = img;
    }
    b.addEventListener("pointerenter", preload);
    b.addEventListener("focus", preload);
    b.addEventListener("click", function () {
      document.querySelectorAll(".chips button").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      after.src = src;
      var webp = after.parentNode.querySelector("source");  // <picture>: the WebP source wins over img.src
      if (webp) webp.srcset = webpSet;
      after.alt = en ? "Cherry blossom photo in the " + b.textContent + " style" : b.textContent + " 스타일을 입힌 벚꽃 사진";
      name.textContent = b.textContent;
    });
  });
  // Look cards: show the original while pressed (touch) or hovered (mouse).
  document.querySelectorAll(".shot").forEach(function (el) {
    // The original is only seen while pressing, so fetch it on the first hover/press/focus.
    ["pointerenter", "pointerdown", "focusin"].forEach(function (t) {
      el.addEventListener(t, function () {
        el.querySelectorAll("source[data-srcset]").forEach(function (s) { s.srcset = s.dataset.srcset; s.removeAttribute("data-srcset"); });
        el.querySelectorAll("img[data-src]").forEach(function (i) { i.src = i.dataset.src; i.removeAttribute("data-src"); });
      }, { once: true });
    });
    el.setAttribute("role", "button"); el.setAttribute("aria-pressed", "false");
    function on() { el.classList.add("show-before"); el.setAttribute("aria-pressed", "true"); }
    function off() { el.classList.remove("show-before"); el.setAttribute("aria-pressed", "false"); }
    el.addEventListener("pointerdown", on);
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (t) { el.addEventListener(t, off); });
    el.addEventListener("keydown", function (e) { if (e.key === " " || e.key === "Enter") { e.preventDefault(); on(); } });
    el.addEventListener("keyup", off);
    el.addEventListener("blur", off);
    el.addEventListener("click", function (e) { if (e.detail === 0) { if (el.classList.contains("show-before")) off(); else on(); } });
    el.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  });
})();
