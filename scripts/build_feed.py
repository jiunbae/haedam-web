#!/usr/bin/env python3
"""community/recipes.src.json -> community/feed.json

각 레시피의 params를 해담 레시피 링크 v1 payload로 인코딩해요.
  payload = base64url(no padding)(UTF-8 JSON {"v":1,"n":name,"k":keepCast,"p":{key:int, 0이 아닌 값만}})
표준 라이브러리만 써요. 사용법: python3 scripts/build_feed.py [--check]
"""
import base64
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "community" / "recipes.src.json"
OUT = ROOT / "community" / "feed.json"

BASIC = ["exposure", "brilliance", "highlights", "shadows", "contrast", "brightness", "blackPoint",
         "saturation", "vibrance", "warmth", "tint", "sharpness", "vignette"]
BANDS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"]
CURVES = ["master", "red", "green", "blue"]

# assets/recipe.js 와 같은 순서·범위
RANGES = {}
for k in BASIC:
    RANGES[k] = (-100, 100)
for b in BANDS:
    for part in ("hue", "sat", "lum"):
        RANGES[f"hsl.{b}.{part}"] = (-100, 100)
for c in CURVES:
    for i in range(5):
        RANGES[f"curve.{c}.{i}"] = (-100, 100)
for k in ("shadowHue", "shadowSat", "midHue", "midSat", "highlightHue", "highlightSat", "balance"):
    RANGES[k] = (0, 359) if k.endswith("Hue") else (-100, 100)
for k in ("grain", "grainSize", "fade"):
    RANGES[k] = (0, 100)
ORDER = list(RANGES)
assert len(ORDER) == 67, len(ORDER)


def encode(name, keep_cast, params):
    unknown = set(params) - set(RANGES)
    if unknown:
        raise ValueError(f"{name}: 알 수 없는 키 {sorted(unknown)}")
    p = {}
    for key in ORDER:
        if key not in params:
            continue
        v = params[key]
        lo, hi = RANGES[key]
        if not isinstance(v, int) or isinstance(v, bool) or not lo <= v <= hi:
            raise ValueError(f"{name}: {key}={v!r} 는 {lo}..{hi} 정수여야 해요")
        if v != 0:
            p[key] = v
    if not 0 <= keep_cast <= 1:
        raise ValueError(f"{name}: keepCast {keep_cast} 는 0..1 이어야 해요")
    k = int(keep_cast) if float(keep_cast).is_integer() else keep_cast
    obj = {"v": 1, "n": name, "k": k, "p": p}
    raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def build():
    src = json.loads(SRC.read_text(encoding="utf-8"))
    ids = set()
    recipes = []
    for r in src["recipes"]:
        if r["id"] in ids:
            raise ValueError(f"중복 id: {r['id']}")
        ids.add(r["id"])
        recipes.append({
            "id": r["id"],
            "name": r["name"],
            "author": r["author"],
            "summary": r["summary"],
            "tags": r["tags"],
            "accent": r["accent"],
            "payload": encode(r["name"], r["keepCast"], r["params"]),
        })
        # Example photo (paths relative to the site root; the app prefixes its web base).
        if "photo" in r:
            recipes[-1].update({"image": r["photo"]["image"], "imageBefore": r["photo"]["before"],
                                "photoCredit": r["photo"]["credit"]})
    feed = {"version": 1, "updated": src["updated"], "recipes": recipes}
    return json.dumps(feed, ensure_ascii=False, indent=2) + "\n"


def main():
    text = build()
    if "--check" in sys.argv:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != text:
            print("feed.json 이 recipes.src.json 과 달라요. build_feed.py 를 다시 돌려주세요.")
            sys.exit(1)
        print("feed.json 최신 상태예요.")
        return
    OUT.write_text(text, encoding="utf-8")
    n = text.count('"payload"')
    print(f"{OUT.relative_to(ROOT)} 에 레시피 {n}개를 썼어요.")


if __name__ == "__main__":
    main()
