/* 해담 레시피 링크 v1 — 인코딩/디코딩과 한국어 라벨.
 * iOS 앱과 같은 형식이어야 해요:
 *   payload = base64url(no padding)(UTF-8 JSON {"v":1,"n":name,"k":keepCast,"p":{key:int}})
 * 브라우저에서는 window.HaedamRecipe, Node에서는 globalThis.HaedamRecipe로 노출돼요.
 */
(function (root) {
  "use strict";

  var VERSION = 1;
  var NAME_MAX = 60;

  var BASIC = [
    ["exposure", "노출"], ["brilliance", "휘도"], ["highlights", "하이라이트"],
    ["shadows", "그림자"], ["contrast", "대비"], ["brightness", "밝기"],
    ["blackPoint", "블랙포인트"], ["saturation", "채도"], ["vibrance", "색 선명도"],
    ["warmth", "따뜻함"], ["tint", "색조"], ["sharpness", "선명도"], ["vignette", "비네트"]
  ];
  var BANDS = [
    ["red", "빨강"], ["orange", "주황"], ["yellow", "노랑"], ["green", "초록"],
    ["aqua", "청록"], ["blue", "파랑"], ["purple", "보라"], ["magenta", "자홍"]
  ];
  var HSL_PARTS = [["hue", "색조"], ["sat", "채도"], ["lum", "밝기"]];
  var CURVES = [["master", "RGB"], ["red", "빨강"], ["green", "초록"], ["blue", "파랑"]];
  var GRADING = [
    ["shadowHue", "그림자 색", 0, 359], ["shadowSat", "그림자 강도", -100, 100],
    ["midHue", "중간톤 색", 0, 359], ["midSat", "중간톤 강도", -100, 100],
    ["highlightHue", "하이라이트 색", 0, 359], ["highlightSat", "하이라이트 강도", -100, 100],
    ["balance", "균형", -100, 100]
  ];
  var FILM = [["grain", "그레인"], ["grainSize", "입자 크기"], ["fade", "페이드"]];

  // 정의 순서가 곧 표시·인코딩 순서예요.
  var PARAMS = [];
  BASIC.forEach(function (b) { PARAMS.push({ key: b[0], label: b[1], group: "basic", min: -100, max: 100 }); });
  BANDS.forEach(function (band) {
    HSL_PARTS.forEach(function (part) {
      PARAMS.push({ key: "hsl." + band[0] + "." + part[0], label: band[1] + " " + part[1], group: "hsl", min: -100, max: 100 });
    });
  });
  CURVES.forEach(function (c) {
    for (var i = 0; i < 5; i++) {
      PARAMS.push({ key: "curve." + c[0] + "." + i, label: c[1] + " 점" + (i + 1), group: "curve", min: -100, max: 100 });
    }
  });
  GRADING.forEach(function (g) {
    PARAMS.push({ key: g[0], label: g[1], group: "grading", min: g[2], max: g[3], hue: g[3] === 359 });
  });
  FILM.forEach(function (f) { PARAMS.push({ key: f[0], label: f[1], group: "film", min: 0, max: 100 }); });

  var BY_KEY = {};
  PARAMS.forEach(function (p) { BY_KEY[p.key] = p; });

  var GROUPS = [
    { id: "basic", label: "기본" }, { id: "hsl", label: "HSL" }, { id: "curve", label: "커브" },
    { id: "grading", label: "그레이딩" }, { id: "film", label: "필름" }
  ];

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  // ---------- base64url (RFC 4648 §5, 패딩 없음) ----------
  function bytesToB64url(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlToBytes(s) {
    if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) {
      throw new Error("base64url 형식이 아니에요");
    }
    var b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ---------- 정규화 ----------
  function normalizeParams(raw) {
    var out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    PARAMS.forEach(function (def) {
      if (!Object.prototype.hasOwnProperty.call(raw, def.key)) return;
      var v = raw[def.key];
      if (typeof v !== "number" || !isFinite(v)) return;
      v = clamp(Math.round(v), def.min, def.max);
      if (v !== 0) out[def.key] = v;
    });
    return out;
  }

  function normalizeKeepCast(k) {
    if (typeof k !== "number" || !isFinite(k)) return 0;
    return clamp(k, 0, 1);
  }

  // ---------- 인코딩 ----------
  function encode(recipe) {
    var params = normalizeParams(recipe.params || recipe.p);
    var obj = {
      v: VERSION,
      n: Array.from(String(recipe.name != null ? recipe.name : (recipe.n || ""))).slice(0, NAME_MAX).join(""),
      k: normalizeKeepCast(recipe.keepCast != null ? recipe.keepCast : recipe.k),
      p: params
    };
    return bytesToB64url(new TextEncoder().encode(JSON.stringify(obj)));
  }

  // ---------- 디코딩 ----------
  // 성공: { name, keepCast, params }  /  실패: Error를 던져요.
  function decode(payload) {
    if (typeof payload !== "string") throw new Error("링크가 비어 있어요");
    payload = payload.trim().replace(/^#/, "");
    if (!payload) throw new Error("링크가 비어 있어요");
    var text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(b64urlToBytes(payload));
    } catch (e) {
      throw new Error("링크를 읽을 수 없어요");
    }
    var obj;
    try { obj = JSON.parse(text); } catch (e) { throw new Error("레시피 내용이 올바르지 않아요"); }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("레시피 내용이 올바르지 않아요");
    if (obj.v !== VERSION) throw new Error("지원하지 않는 레시피 버전이에요");
    if (obj.p != null && (typeof obj.p !== "object" || Array.isArray(obj.p))) throw new Error("레시피 내용이 올바르지 않아요");
    var name = typeof obj.n === "string" ? Array.from(obj.n.trim()).slice(0, NAME_MAX).join("") : "";
    return {
      name: name || "이름 없는 레시피",
      keepCast: normalizeKeepCast(obj.k),
      params: normalizeParams(obj.p || {})
    };
  }

  // 그룹별로 묶은 표시용 행 목록
  function grouped(params) {
    return GROUPS.map(function (g) {
      var rows = PARAMS.filter(function (d) { return d.group === g.id && params[d.key]; })
        .map(function (d) { return { key: d.key, label: d.label, value: params[d.key], hue: !!d.hue }; });
      return { id: g.id, label: g.label, rows: rows };
    }).filter(function (g) { return g.rows.length; });
  }

  // 그레이딩 값으로 만든 미리보기 그라데이션
  function swatch(params) {
    var sh = params.shadowHue != null ? params.shadowHue : 220;
    var hh = params.highlightHue != null ? params.highlightHue : 40;
    var ss = clamp(20 + Math.abs(params.shadowSat || 0) * 1.6, 15, 60);
    var hs = clamp(35 + Math.abs(params.highlightSat || 0) * 1.6, 25, 75);
    var w = (params.warmth || 0) / 4;
    var hl = ((hh + w) % 360 + 360) % 360;
    // 중간톤은 색상환에서 섞지 않고 하이라이트 쪽 중성 톤으로 둬요 (보색끼리 섞이면 엉뚱한 색이 나와요).
    return "linear-gradient(140deg, hsl(" + sh + " " + ss + "% 20%) 0%, hsl(" + hl + " 10% 44%) 52%, hsl(" + hl + " " + hs + "% 78%) 100%)";
  }

  var api = {
    VERSION: VERSION, PARAMS: PARAMS, GROUPS: GROUPS, BY_KEY: BY_KEY,
    encode: encode, decode: decode, grouped: grouped, swatch: swatch,
    normalizeParams: normalizeParams
  };
  root.HaedamRecipe = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
