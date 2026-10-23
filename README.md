# 해담 웹사이트

빌드 단계 없는 정적 사이트예요. HTML/CSS/바닐라 JS만 쓰고, 외부 CDN·폰트·트래커는 없어요.

## 로컬에서 보기

```sh
cd web
python3 -m http.server 8000
# http://localhost:8000/
```

`community/`는 `fetch("./feed.json")`을 쓰기 때문에 `file://`로 열면 안 되고 꼭 로컬 서버로 열어야 해요.

## 파일 구성

```
web/
├── index.html                 랜딩 (히어로 비교, 8가지 기본 룩, 기능, 커뮤니티 티저)
├── r/index.html               레시피 뷰어 — /r/#<payload>
├── community/
│   ├── index.html             커뮤니티 레시피 목록 (검색·태그 필터)
│   ├── recipes.src.json       사람이 읽는 원본 (여기를 고쳐요)
│   └── feed.json              생성 파일 — 직접 고치지 마세요
├── assets/
│   ├── style.css              공통 스타일
│   ├── recipe.js              링크 인코딩/디코딩, 한국어 라벨
│   ├── render.js              해담 렌더러 v2 (앱·Python과 같은 계산), 레시피 페이지 미리보기
│   ├── render-worker.js       미리보기를 화면 밖에서 그리는 Worker
│   └── photos/                예시 사진 (Unsplash, CREDITS.md). ml/render_landing.py로 만들어요
└── scripts/
    ├── build_feed.py          recipes.src.json → feed.json (표준 라이브러리만)
    └── test_recipe.mjs        인코딩/디코딩 왕복 테스트 (Node, 의존성 없음)
```

## 피드 갱신과 테스트

```sh
python3 scripts/build_feed.py          # feed.json 다시 만들기
python3 scripts/build_feed.py --check  # feed.json이 최신인지만 확인
node scripts/test_recipe.mjs           # 왕복 테스트
node scripts/test_render.mjs           # 웹 렌더러가 Python 기준 구현과 픽셀 단위로 같은지
```

`build_feed.py`는 알 수 없는 키나 범위를 벗어난 값이 있으면 멈춰요.

## 레시피 링크 형식 v1

iOS 앱과 똑같아야 해요.

- 링크: `https://haedam.jiun.dev/r/#<payload>` (웹), `haedam://recipe#<payload>` (앱)
- `payload` = UTF-8 JSON을 base64url(RFC 4648 §5, `=` 패딩 없음)로 인코딩한 값
- JSON: `{"v":1,"n":"이름","k":0.3,"p":{"exposure":8, ...}}`
  - `v` 버전. 1이 아니면 거부해요.
  - `n` 이름 문자열, `k` keepCast(원래 색 유지, 0..1)
  - `p` 0이 아닌 값만 담은 정수 파라미터

| 그룹 | 키 | 범위 |
|---|---|---|
| 기본 | `exposure` `brilliance` `highlights` `shadows` `contrast` `brightness` `blackPoint` `saturation` `vibrance` `warmth` `tint` `sharpness` `vignette` | -100..100 |
| HSL | `hsl.<red\|orange\|yellow\|green\|aqua\|blue\|purple\|magenta>.<hue\|sat\|lum>` | -100..100 |
| 커브 | `curve.<master\|red\|green\|blue>.<0-4>` (기본 곡선에서의 차이) | -100..100 |
| 그레이딩 | `shadowHue` `midHue` `highlightHue` | 0..359 |
| | `shadowSat` `midSat` `highlightSat` `balance` | -100..100 |
| 필름 | `grain` `grainSize` `fade` | 0..100 |

모두 67개예요. 디코더는 범위 밖 값을 잘라내고(정수로 반올림), 모르는 키는 무시하고, UTF-8은 `TextEncoder`/`TextDecoder`로 처리해요.

## 아직 정해지지 않은 것

- 도메인: 링크 복사는 현재 페이지 주소를 그대로 써요. 도메인이 정해지면 따로 고칠 곳은 없어요.
- App Store 링크: `https://apps.apple.com/kr/app/id6823169776` (`index.html` 두 곳, `r/` 앱 받기). 세 페이지에 Smart App Banner(`apple-itunes-app`) 메타가 있어요.
- 커뮤니티 피드는 직접 고른 16개예요. 사용자 제출 기능은 아직 없어요.
