/*
 * 해담 렌더러 v2의 브라우저 버전 (ml/haru_renderer.py, ml/haru_looks.py와 같은 계산).
 * 앱과 같은 결과를 내도록 Python 기준 구현과 픽셀 단위로 비교 테스트해요 (scripts/test_render.mjs).
 *
 *   var out = HaedamRender.render(pixels, width, height, params, intensity)
 *     pixels: Float32Array(width * height * 3), sRGB 0..1
 *   var p = HaedamRender.lookParams(smallPixels, w, h, recipeParams, keepCast)
 *     사진마다 노출과 색온도를 먼저 맞춘 뒤 레시피 수치를 더해요 (앱의 "자동 보정 + 레시피").
 */
(function (root) {
  "use strict";

  var BASIC = ["exposure", "brilliance", "highlights", "shadows", "contrast", "brightness",
    "blackPoint", "saturation", "vibrance", "warmth", "tint", "sharpness", "vignette"];
  var BANDS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"];
  var CENTERS = [0, 30, 60, 120, 180, 240, 270, 300, 360].map(function (d) { return d / 360; });
  var CURVES = ["master", "red", "green", "blue"];
  var KEYS = BASIC.slice();
  BANDS.forEach(function (b) { ["hue", "sat", "lum"].forEach(function (c) { KEYS.push("hsl." + b + "." + c); }); });
  CURVES.forEach(function (c) { for (var i = 0; i < 5; i++) KEYS.push("curve." + c + "." + i); });
  KEYS.push("shadowHue", "shadowSat", "midHue", "midSat", "highlightHue", "highlightSat", "balance", "grain", "grainSize", "fade");
  var HUE = { shadowHue: 1, midHue: 1, highlightHue: 1 };

  var EV_RANGE = 2, WARMTH_K = 0.25, TINT_K = 0.15, SHOULDER = 0.8, HL_K = 0.35, SH_K = 0.35, BRILL_K = 0.2,
    BRIGHT_K = 0.7, CONTRAST_K = 0.6, BP_K = 0.12, HSL_HUE_K = 30 / 360, HSL_LUM_K = 0.35, CURVE_K = 0.25,
    GRADE_K = 0.18, FADE_K = 0.12, GRAIN_K = 0.09, VIGNETTE_K = 0.5, SHARP_K = 1;
  var LR = 0.2126, LG = 0.7152, LB = 0.0722;

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function smooth(e0, e1, x) { var t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); }
  function toLin(c) { c = Math.max(c, 0); return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  // Exact table hits only for the Float32 byte inputs used by canvas. Arbitrary
  // float/HDR callers retain the analytic formula; no interpolation/quantization.
  var encodedBytes = new Float32Array(256), linearBytes = new Float64Array(256);
  for (var byte = 0; byte < 256; byte++) {
    encodedBytes[byte] = byte / 255;
    linearBytes[byte] = toLin(encodedBytes[byte]);
  }
  function inputLinear(c) {
    var byte = Math.round(c * 255);
    return c === encodedBytes[byte] ? linearBytes[byte] : toLin(c);
  }
  function toSrgb(c) { c = Math.max(c, 0); return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
  function mod(a, n) { return ((a % n) + n) % n; }

  function normalized(params, intensity) {
    var p = {};
    KEYS.forEach(function (k) {
      var v = Number(params[k] || 0);
      p[k] = HUE[k] ? v / 360 : v / 100 * (k === "grainSize" ? 1 : intensity);
    });
    return p;
  }

  var HSV_OFFSETS = [5, 3, 1];

  // HSV <-> RGB, written to a 3-slot array to avoid allocations per pixel.
  function hsv2rgb(h, s, v, out) {
    for (var j = 0; j < 3; j++) {
      var k = mod(HSV_OFFSETS[j] + h * 6, 6);
      out[j] = v - v * s * Math.max(0, Math.min(Math.min(k, 4 - k), 1));
    }
  }

  function hueTint(h) {
    var c = [0, 0, 0];
    hsv2rgb(h, 1, 1, c);
    var y = c[0] * LR + c[1] * LG + c[2] * LB;
    return [c[0] - y, c[1] - y, c[2] - y];
  }

  function catmull(y, x) {
    var t = clamp01(x) * 4, i = Math.min(Math.floor(t), 3), u = t - i;
    var p0 = y[i], p1 = y[i + 1], p2 = y[i + 2], p3 = y[i + 3];
    return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
  }

  // Move luminance from yOld to yNew keeping color ratios; desaturate only what would clip.
  function applyLuma(c, yOld, yNew) {
    var ratio = yNew / Math.max(yOld, 1e-4), w = smooth(0, 0.04, yOld), d = yNew - yOld;
    for (var j = 0; j < 3; j++) c[j] = c[j] * ratio * w + (c[j] + d) * (1 - w);
    var mx = Math.max(c[0], c[1], c[2]);
    if (mx > 1) {
      var yn = clamp01(yNew), s = (1 - yn) / Math.max(mx - yn, 1e-4);
      for (j = 0; j < 3; j++) c[j] = yn + (c[j] - yn) * s;
    }
  }

  function colorPass(src, w, h, p) {
    var out = new Float32Array(w * h * 3);
    var ex = Math.pow(2, p.exposure * EV_RANGE);
    var wbR = Math.pow(2, p.warmth * WARMTH_K), wbG = Math.pow(2, -p.tint * TINT_K), wbB = Math.pow(2, -p.warmth * WARMTH_K);
    var curves = CURVES.map(function (c) {
      var ys = []; for (var i = 0; i < 5; i++) ys.push(i / 4 + p["curve." + c + "." + i] * CURVE_K);
      return [2 * ys[0] - ys[1], ys[0], ys[1], ys[2], ys[3], ys[4], 2 * ys[4] - ys[3]];
    });
    var hasCurves = KEYS.some(function (k) { return k.indexOf("curve.") === 0 && p[k] !== 0; });
    var hsl = BANDS.map(function (b) { return [p["hsl." + b + ".hue"], p["hsl." + b + ".sat"], p["hsl." + b + ".lum"]]; });
    hsl.push(hsl[0]);
    var hasHSL = KEYS.some(function (k) { return k.indexOf("hsl.") === 0 && p[k] !== 0; });
    var hasGrade = p.shadowSat || p.midSat || p.highlightSat;
    var tS = hueTint(p.shadowHue), tM = hueTint(p.midHue), tH = hueTint(p.highlightHue);
    var bal = p.balance * 0.25, d = p.blackPoint * BP_K, f = p.fade;
    var c = [0, 0, 0];
    var brightnessExponent = Math.pow(2, -p.brightness * BRIGHT_K);
    var fadeScale = 1 - f * FADE_K * 1.5, fadeOffset = f * FADE_K;
    var vignetteX = p.vignette !== 0 ? new Float64Array(w) : null;
    if (vignetteX) for (var vx = 0; vx < w; vx++) vignetteX[vx] = Math.pow(((vx + 0.5) / w - 0.5) * 2, 2);

    for (var py = 0; py < h; py++) {
      var vignetteY = vignetteX ? Math.pow(((py + 0.5) / h - 0.5) * 2, 2) : 0;
      for (var px = 0; px < w; px++) {
        var o = (py * w + px) * 3, j;
        // 1. linear: exposure, white balance (luminance kept), soft shoulder
        for (j = 0; j < 3; j++) c[j] = inputLinear(src[o + j]) * ex;
        var y0 = c[0] * LR + c[1] * LG + c[2] * LB;
        c[0] *= wbR; c[1] *= wbG; c[2] *= wbB;
        var y1 = c[0] * LR + c[1] * LG + c[2] * LB, k0 = y0 / Math.max(y1, 1e-6);
        for (j = 0; j < 3; j++) {
          var l = c[j] * k0;
          if (l > SHOULDER) l = SHOULDER + (1 - SHOULDER) * Math.tanh((l - SHOULDER) / (1 - SHOULDER));
          c[j] = toSrgb(l);
        }
        // 2. tone on luminance, white and black anchored
        var y = clamp01(c[0] * LR + c[1] * LG + c[2] * LB), L = y;
        var hb = 4 * smooth(0.3, 1, L) * (1 - L), sb = 4 * (1 - smooth(0, 0.7, L)) * L;
        L = clamp01(L + p.highlights * HL_K * hb + p.shadows * SH_K * sb + p.brilliance * BRILL_K * (sb - hb));
        if (brightnessExponent !== 1) L = Math.pow(L, brightnessExponent);
        L = L + p.contrast * CONTRAST_K * (L * L * (3 - 2 * L) - L);
        L = d >= 0 ? clamp01((L - d) / (1 - d)) : -d + L * (1 + d);
        applyLuma(c, y, L);
        // 3. curves: master on every channel, then per channel
        if (hasCurves) {
          for (j = 0; j < 3; j++) c[j] = catmull(curves[j + 1], clamp01(catmull(curves[0], clamp01(c[j]))));
        }
        // 4. HSL by hue band
        if (hasHSL) {
          for (j = 0; j < 3; j++) c[j] = clamp01(c[j]);
          var mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), dd = mx - mn;
          var ss = mx > 1e-6 ? dd / Math.max(mx, 1e-6) : 0, hh = 0;
          if (dd > 1e-6) {
            hh = mx === c[0] ? mod((c[1] - c[2]) / dd, 6) : mx === c[1] ? (c[2] - c[0]) / dd + 2 : (c[0] - c[1]) / dd + 4;
            hh = mod(hh / 6, 1);
          }
          var idx = 0;
          while (idx < 7 && hh >= CENTERS[idx + 1]) idx++;
          var t = (hh - CENTERS[idx]) / (CENTERS[idx + 1] - CENTERS[idx]), st = smooth(0.04, 0.2, ss);
          var bh = hsl[idx][0] * (1 - t) + hsl[idx + 1][0] * t, bs = hsl[idx][1] * (1 - t) + hsl[idx + 1][1] * t,
            bl = hsl[idx][2] * (1 - t) + hsl[idx + 1][2] * t;
          hsv2rgb(mod(hh + bh * HSL_HUE_K * st, 1), clamp01(ss * (1 + bs * st)), mx, c);
          var yb = c[0] * LR + c[1] * LG + c[2] * LB;
          applyLuma(c, yb, clamp01(yb * (1 + bl * HSL_LUM_K * st)));
        }
        // 5. saturation, vibrance
        var y2 = c[0] * LR + c[1] * LG + c[2] * LB;
        for (j = 0; j < 3; j++) c[j] = y2 + (c[j] - y2) * (1 + p.saturation);
        var sat = clamp01(Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]));
        var y3 = c[0] * LR + c[1] * LG + c[2] * LB, vib = 1 + p.vibrance * (1 - sat);
        for (j = 0; j < 3; j++) c[j] = y3 + (c[j] - y3) * vib;
        // 6. color grading
        if (hasGrade) {
          var Lg = clamp01(c[0] * LR + c[1] * LG + c[2] * LB);
          var ws = 1 - smooth(0, 0.5 + bal, Lg), wh = smooth(0.5 + bal, 1, Lg), wm = clamp01(1 - ws - wh);
          for (j = 0; j < 3; j++) {
            c[j] += GRADE_K * (ws * p.shadowSat * tS[j] + wm * p.midSat * tM[j] + wh * p.highlightSat * tH[j]);
          }
        }
        // 7. fade, 8. vignette
        var vg = 1;
        if (vignetteX) {
          var r = Math.sqrt(vignetteX[px] + vignetteY) / Math.SQRT2;
          vg = 1 - p.vignette * VIGNETTE_K * smooth(0.3, 1, r);
        }
        for (j = 0; j < 3; j++) out[o + j] = clamp01((c[j] * fadeScale + fadeOffset) * vg);
      }
    }
    return out;
  }

  function grainNoise(x, y) {
    var n = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0;
    n = Math.imul((n ^ (n >>> 13)) >>> 0, 1274126177) >>> 0;
    n = (n ^ (n >>> 16)) >>> 0;
    return n / 4294967296 - 0.5;
  }

  function finishPass(img, w, h, p) {
    var out = img, j;
    if (p.sharpness !== 0) {
      out = new Float32Array(img.length);
      var kk = [1, 2, 1];
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var o = (y * w + x) * 3, b0 = 0, b1 = 0, b2 = 0;
          for (var dy = -1; dy <= 1; dy++) {
            var yy = Math.min(h - 1, Math.max(0, y + dy));
            for (var dx = -1; dx <= 1; dx++) {
              var xx = Math.min(w - 1, Math.max(0, x + dx)), k = kk[dy + 1] * kk[dx + 1], q = (yy * w + xx) * 3;
              b0 += k * img[q]; b1 += k * img[q + 1]; b2 += k * img[q + 2];
            }
          }
          out[o] = clamp01(img[o] + p.sharpness * SHARP_K * (img[o] - b0 / 16));
          out[o + 1] = clamp01(img[o + 1] + p.sharpness * SHARP_K * (img[o + 1] - b1 / 16));
          out[o + 2] = clamp01(img[o + 2] + p.sharpness * SHARP_K * (img[o + 2] - b2 / 16));
        }
      }
    }
    if (p.grain !== 0) {
      // Same integer cell math as the app and Python, so grain matches exactly.
      var f32 = Math.fround;  // float32 like the reference, so the cell size never differs by one
      var cells = f32(f32(900) / f32(1 + f32(f32(p.grainSize) * 3)));
      var scale = Math.max(1, pyRound(f32(f32(256 * cells) / Math.min(w, h))));
      for (var gy = 0; gy < h; gy++) {
        var cy = (gy * scale) >> 8;
        for (var gx = 0; gx < w; gx++) {
          var g = (gy * w + gx) * 3, Ln = out[g] * LR + out[g + 1] * LG + out[g + 2] * LB;
          var amp = p.grain * GRAIN_K * (0.35 + 2.6 * Ln * (1 - Ln)), n = grainNoise((gx * scale) >> 8, cy) * amp;
          for (j = 0; j < 3; j++) out[g + j] = clamp01(out[g + j] + n);
        }
      }
    }
    return out;
  }

  function render(pixels, w, h, params, intensity) {
    var p = normalized(params, intensity == null ? 1 : intensity);
    return finishPass(colorPass(pixels, w, h, p), w, h, p);
  }

  // --- per-photo auto correction (ImageStats + LookRecommender.autoCorrection) ---

  function quantile(sorted, q) {
    var pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  function stats(px, w, h) {
    var n = w * h, ys = new Float64Array(n), usable = new Uint8Array(n), rel = new Float64Array(n), i;
    var hiClip = 0, neutral = 0, usableRel = [];
    for (i = 0; i < n; i++) {
      var r = px[i * 3], g = px[i * 3 + 1], b = px[i * 3 + 2];
      var y = r * LR + g * LG + b * LB, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      ys[i] = y;
      if (y > 0.98) hiClip++;
      usable[i] = y > 0.03 && mx < 0.97 ? 1 : 0;
      rel[i] = usable[i] ? (mx - mn) / Math.max(mx, 1e-6) : 1;
      if (rel[i] < 0.3) neutral++;
      if (usable[i]) usableRel.push(rel[i]);
    }
    var sorted = ys.sort();
    var pct = [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99].map(function (q) { return quantile(sorted, q); });
    var limit = 0.3;
    if (usableRel.length) {
      usableRel.sort(function (a, b) { return a - b; });
      limit = Math.max(0.3, usableRel[Math.floor((usableRel.length - 1) * 0.3)]);
    }
    var sum = [0, 0, 0], cnt = 0;
    for (i = 0; i < n; i++) {
      if (!usable[i] || rel[i] > limit) continue;
      for (var j = 0; j < 3; j++) sum[j] += toLin(px[i * 3 + j]);
      cnt++;
    }
    var castWarm = 0, castTint = 0;
    if (cnt) {
      var m = sum.map(function (s) { return s / cnt + 1e-4; });
      castWarm = Math.log2(m[0] / m[2]);
      castTint = Math.log2(m[1] / Math.sqrt(m[0] * m[2]));
    }
    return { p: pct, hiClip: hiClip / n, neutral: neutral / n, castWarm: castWarm, castTint: castTint };
  }

  function clip(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function autoCorrection(s, keepCast) {
    var p50 = s.p[3], p95 = s.p[5], p99 = s.p[6];
    var ev = Math.log2(toLin(0.45) / toLin(Math.max(p50, 0.02))) * 0.5;
    if (ev > 0) {
      var headroom = Math.log2(1 / Math.max(toLin(p99), 1e-3));
      ev = Math.min(ev, Math.max(headroom - 0.1, 0), 0.8);
      if (p95 > 0.85) ev = Math.min(ev, 0.2);
    } else if (p50 > 0.72 && s.hiClip > 0.05) {
      ev = Math.max(ev * 0.5, -0.3);
    } else {
      ev = 0;
    }
    var out = { exposure: pyRound(ev / 2 * 100) };
    if (s.hiClip > 0.01) out.highlights = -Math.trunc(Math.min(40, 10 + s.hiClip * 600));
    if (s.p[1] < 0.03 && p50 > 0.3) out.shadows = Math.trunc(Math.min(20, (0.03 - s.p[1]) * 500));
    var cast = s.castWarm - 0.1, confidence = 0.5 + 0.5 * clip(s.neutral / 0.15, 0, 1);
    var removed = cast * (1 - keepCast) * confidence;
    out.warmth = pyRound(clip(-removed / 0.5 * 100, -40, 40));
    out.tint = pyRound(clip(s.castTint * 0.5 / 0.15 * 100 * confidence, -20, 20));
    return out;
  }

  // Python's round(): halves go to the even neighbor.
  function pyRound(x) {
    var r = Math.round(x);
    return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
  }

  function lookParams(smallPx, w, h, delta, keepCast) {
    var p = autoCorrection(stats(smallPx, w, h), keepCast);
    Object.keys(delta).forEach(function (k) {
      p[k] = clip((p[k] || 0) + delta[k], -100, /Hue$/.test(k) ? 360 : 100);
    });
    return p;
  }

  var api = { KEYS: KEYS, render: render, stats: stats, autoCorrection: autoCorrection, lookParams: lookParams };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HaedamRender = api;
})(typeof self !== "undefined" ? self : this);
