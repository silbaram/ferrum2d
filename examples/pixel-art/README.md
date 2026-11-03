# 작은 빛의 정원 · 도트 쇼케이스

320×192 가상 해상도의 작은 정원을 걸으며 빛의 씨앗 세 개를 모으는 예제다.
도트 원본·태그 애니메이션·노멀 조명·팔레트 스왑·후처리를 한 게임에서 확인한다.

```bash
pnpm dev:pixel-art
```

- 바닥 클릭 또는 키보드로 `서쪽/동쪽/북쪽 씨앗` 버튼을 눌러 이동한다. Rust가 길 찾기·충돌·걷기/정지·수집을 처리한다.
- 포인터를 정원 위로 움직이면 노멀 조명의 위치가 바뀐다. `낮`은 조명을 끈 원본 색상이다.
- 팔레트는 같은 PNG의 옷 색만 바꾼다. 원본 픽셀과 노멀은 바뀌지 않는다.
- 화면 효과에서 bloom/vignette, 도트 디더/스캔라인, 곡면 CRT, glitch를 비교한다.
- WebGL2가 기본이다. WebGPU 선택은 페이지를 새로 시작하며, 사용할 수 없으면 실제 fallback 상태를 표시한다.
- 정수 배율은 브라우저 크기와 DPR에서 결정한다. 창이 가상 해상도보다 작으면 기존 pixel-perfect 축소 정책을 따른다.

`pnpm build:pages` 후 Pages 홈 또는 `/pixel-art/`에서 같은 production 예제를 열 수 있다.
개발 소스 예제이며 공개 npm beta에 포함됐다는 뜻은 아니다.

## 원본과 재생성

모든 그림은 Ferrum2D를 위해 작성한 자체 도트다. 외부 아트·Aseprite 코드를 포함하지 않으며 저장소와 동일한 MIT OR Apache-2.0 조건을 따른다.
한글 UI는 기존 뷰어의 Noto Sans KR subset을 재사용한다. SIL OFL 1.1 고지와 출처는 `public/fonts/`에 포함한다.

| 파일 | 용도 |
| --- | --- |
| `public/assets/keeper.pixel.json` | 편집 가능한 v7·24×24·4프레임 원본, 가만히/핑퐁 걷기 태그 |
| `public/assets/keeper.png` | 원본의 기존 2×2 atlas layout으로 만든 48×48 색상 시트 |
| `public/assets/keeper-normal.png` | 같은 배치의 둥근 노멀 데이터. colorSpace는 none |
| `public/assets/star.pixel.json` | 씨앗 원본 |
| `public/assets/tiles.png`, `flower.png`, `star.png` | 정원 타일과 장식·수집 오브젝트 |
| `public/assets/pixel-art.profile.json` | 실제 색상 PNG의 팔레트·타일·정수 배율·nearest 선언 검증 |
| `public/scene.json` | native navigation·collisionPickup·변수와 animationSet을 사용하는 Data Scene |

`scripts/generate-assets.mjs`가 원본·PNG·씬을 결정적으로 재생성한다.
`pnpm --filter @ferrum2d/pixel-art assets`는 위 파일을 덮어쓴다. 편집한 원본을 유지하려면 먼저 별도로 저장한다.
일반 build와 실행은 원본을 재생성하지 않는다. 노멀맵은 색상 팔레트 검증 대상에서 제외한다.

## 검증

```bash
pnpm --filter @ferrum2d/pixel-art build
pnpm smoke:pixel-showcase
```

브라우저 검증은 production build와 project subpath에서 실제 이동·수집·애니메이션·효과 차이·크기 변경·자원 해제를 확인한다.
WebGPU 화면 비교는 소프트웨어 GPU의 offscreen readback이며 실물 GPU/OS compositor 검증을 뜻하지 않는다.
검증 결과는 `artifacts/pixel-showcase/`에 저장한다.
