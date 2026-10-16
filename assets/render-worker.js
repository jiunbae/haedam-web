// Decode/read pixels here when OffscreenCanvas is available. Keep one source for
// repeated recipes; the page keeps at most one running and one latest pending job.
importScripts("render.js");
var source = null;
function pixels(canvas, image, w, h) {
  canvas.width = w; canvas.height = h;
  var ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, w, h);
  var data = ctx.getImageData(0, 0, w, h).data, out = new Float32Array(w * h * 3);
  for (var i = 0, j = 0; i < data.length; i += 4, j += 3) {
    out[j] = data[i] / 255; out[j + 1] = data[i + 1] / 255; out[j + 2] = data[i + 2] / 255;
  }
  return out;
}
self.onmessage = function (e) {
  var d = e.data;
  if (d.key === "warm" && self.OffscreenCanvas) {
    // Also warm the canvas path the first real photo takes (context creation is slow once).
    try { var c = new OffscreenCanvas(8, 8), x = c.getContext("2d", { willReadFrequently: true }); x.fillRect(0, 0, 8, 8); x.getImageData(0, 0, 8, 8); }
    catch (error) {}
  }
  var t0 = performance.now(), tp = t0;
  try {
    if (d.bitmap) {
      var canvas = new OffscreenCanvas(d.w, d.h);
      source = { key: d.key, px: pixels(canvas, d.bitmap, d.w, d.h),
        small: pixels(canvas, d.bitmap, d.sw, d.sh), w: d.w, h: d.h, sw: d.sw, sh: d.sh };
    } else if (d.px) {
      source = { key: d.key, px: d.px, small: d.small, w: d.w, h: d.h, sw: d.sw, sh: d.sh };
    }
    if (!source || source.key !== d.key) throw new Error("missing source");
    tp = performance.now();
    var p = HaedamRender.lookParams(source.small, source.sw, source.sh, d.params, d.keepCast);
    var out = HaedamRender.render(source.px, source.w, source.h, p, 1);
    var rgba = new Uint8ClampedArray(source.w * source.h * 4);
    for (var i = 0, j = 0; i < out.length; i += 3, j += 4) {
      rgba[j] = Math.floor(out[i] * 255 + 0.5); rgba[j + 1] = Math.floor(out[i + 1] * 255 + 0.5); rgba[j + 2] = Math.floor(out[i + 2] * 255 + 0.5); rgba[j + 3] = 255;
    }
    self.postMessage({ id: d.id, rgba: rgba, w: source.w, h: source.h,
      timing: { pixels: Math.round(tp - t0), render: Math.round(performance.now() - tp) } }, [rgba.buffer]);
  } catch (error) {
    self.postMessage({ id: d.id, error: "미리보기를 만들지 못했어요. 예시 사진을 다시 골라주세요." });
  } finally {
    if (d.bitmap) d.bitmap.close();
  }
};
