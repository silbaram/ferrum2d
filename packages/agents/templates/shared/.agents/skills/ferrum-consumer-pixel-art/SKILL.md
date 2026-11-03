---
name: ferrum-consumer-pixel-art
description: Create, edit, or validate pixel-art sprites, frame tags, tile atlases and pixel-perfect presentation in a Ferrum2D consumer game. Use the built-in dot authoring workflow and project-owned PNG validation; not engine internals or an AI image-generation service.
---

# Ferrum Consumer Pixel Art

Do not use this skill to edit engine internals, call image-generation services, or deploy a game.

게임의 도트 자산과 실제 표시를 연결한다. 설치만 요청받았다면 게임 콘텐츠를 만들지 않는다.
현재 프로젝트 `README.md`, `package.json`, `.agents/harness/ferrum-game-presentation.md`를 읽고 게임이 사용하는 씬·manifest·SDK 버전을 확인한다.

- 새 원본은 Ferrum 도트 도구에서 만들거나 프로젝트가 가진 원본을 편집한다. `.pixel.json`을 보관하고 PNG/manifest/scene bundle을 명시적으로 등록한다. 외부 Aseprite 앱은 필수가 아니다.
- 팔레트·타일 치수·기준점·프레임 시간·태그 순서를 먼저 정한다. 확대 표시를 위해 원본을 보간해서 키우지 않는다. 투명 픽셀의 RGB와 알파도 원본 데이터다.
- 태그의 정방향·역방향·왕복은 기존 runtime animationSet으로 내보낸다. v7 원본을 저장하려면 편집기와 desktop host가 모두 이를 지원해야 한다. 기본 runtime 게임 상태는 Rust가 소유한다.
- 노멀은 원본/UV/시간이 같은 자산에 연결하며 color는 srgb, normal은 none이다. 원본 편집 후 이전 normal을 새 결과로 취급하지 않는다.

## 프로젝트 검증

생성 프로젝트의 `scripts/ferrum-pixel-assets.mjs`가 있으면 `public/assets/pixel-art.profile.json`을 만든다. 아래는 16×16 RGBA8 PNG의 예이며, 실제 파일·색상·배율로 바꾼다.

```json
{
  "format": "ferrum2d.consumer.pixel-art-profile",
  "version": 1,
  "scale": 3,
  "filter": "nearest",
  "palette": ["#00000000", "#ffffffff"],
  "assets": [{"source": "public/assets/hero.png", "tileWidth": 16, "tileHeight": 16}]
}
```

`npm run ferrum:asset-validate -- --profile pixel-art`로 검증한다. 파일이 있으면 일반 `ferrum:asset-validate`도 검사하므로 `ferrum:check`에 연결된다. 구형 생성 프로젝트에 명령/모듈이 없으면 지원되는 생성기 업데이트 또는 프로젝트 도구 추가 범위를 확인한다. 엔진 저장소 내부 도구를 consumer에 import하지 않는다.

PNG는 8-bit RGBA·비인터레이스, 한 변2048px·16 MiB 이내다. 다른 형식은 명시적으로 변환하고 비교한다. 팔레트는 정확한 `#RRGGBBAA` 1~256색이며 자산별 `palette`로 덮어쓸 수 있다. 투명 RGB도 일치해야 한다.
타일 치수는 PNG 전체에 나누어떨어져야 한다. 여백이 있는 atlas는 자산에 `atlas:{padding,extrude,frames:[{x,y,width,height}]}`를 선언해 실제 content rect를 검사한다. padding은 rect 사방의 예약 여백이며 PNG 경계 안에서 서로 겹치지 않아야 한다. extrude는 실제 복제 픽셀과 대조한다. rect는 정수·비중첩이고 각 크기가 tile 크기의 배수여야 한다.
`scale`은 1~16 정수, `filter`는 nearest 선언이다. 이 검사는 선언과 PNG만 확인하고 실행 중 renderer나 게임 카메라를 읽지 않는다.

## 게임에서 확인

공개 `@ferrum2d/ferrum-web/core`, `/authoring`, `/labs` API만 사용한다. 프로젝트의 가상 해상도/정수 배율·pixel snap과 nearest 설정을 실제 카메라·render texture 경로에서 확인한다.
`npm run ferrum:smoke`와 빌드를 실행하고 DPR/창 크기 변화, 이동·회전·애니메이션, atlas 가장자리, 조명/팔레트 효과를 실제 화면으로 검증한다. JSON 통과를 runtime 성공으로 보고하지 않는다.
원본·생성 명령·검증 report·스크린샷을 남긴다. AI 이미지 생성 서비스 호출이나 배포는 이 스킬의 기본 동작이 아니다.
