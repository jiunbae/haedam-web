// 레시피 미리보기를 화면을 멈추지 않고 그려요. render.js와 같은 계산이에요.
importScripts("render.js");
self.onmessage = function (e) {
  var d = e.data;
  var p = HaedamRender.lookParams(d.small, d.sw, d.sh, d.params, d.keepCast);
  var out = HaedamRender.render(d.px, d.w, d.h, p, 1);
  var rgba = new Uint8ClampedArray(d.w * d.h * 4);
  for (var i = 0, j = 0; i < out.length; i += 3, j += 4) {
    rgba[j] = out[i] * 255 + 0.5; rgba[j + 1] = out[i + 1] * 255 + 0.5; rgba[j + 2] = out[i + 2] * 255 + 0.5; rgba[j + 3] = 255;
  }
  self.postMessage({ id: d.id, rgba: rgba, w: d.w, h: d.h }, [rgba.buffer]);
};
