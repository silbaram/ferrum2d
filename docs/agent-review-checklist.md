# Agent Review Checklist

AI agent 또는 subagent가 Ferrum2D 변경을 마친 뒤 확인할 항목이다.

## Game Spec 변경

- `examples/topdown-shooter/public/game.json` 또는 variant JSON이 유효한 JSON인가?
- 모든 숫자 필드가 positive finite number인가?
- `enemies.behavior`가 `chase`, `drift`, `static`, `orbit` 중 하나인가?
- `enemies.spawnPattern`이 `edge`, `corners`, `center` 중 하나인가?
- `enemies.orbit.radius`가 positive number이고 `enemies.orbit.radialBand`가 non-negative number인가?
- `enemies.presets.*`와 `enemies.waves.*.enemy` 참조가 일치하는가?
- `enemies.waves.*.duration`, `spawnInterval`, `enemyCount`가 positive 값인가?
- `audio.masterVolume`, `audio.sfxVolume`, `audio.events.*.volume`이 non-negative number이고 `audio.events.*.pitch`가 positive number인가?
- `camera.preset`이 `follow`, `dead-zone`, `look-ahead`, `shake` 중 하나인가?
- `enemies.health`, `weapons.damage`가 positive number인가?
- `enemies.scoreReward`가 positive integer인가?
- `camera.deadZone.*`, `camera.lookAhead.distance`, `camera.shake.amplitude`가 non-negative number이고 `camera.shake.frequency`가 positive number인가?
- `prefabs.*.frame`이 존재하면 `atlas.frames`의 frame name을 참조하는가?
- `atlas.frames.*.texture`가 non-empty texture name 또는 non-negative integer texture id인가?
- `atlas.frames.*.uv`가 `0..1` 범위이고 `u1 > u0`, `v1 > v0`인가?
- `atlas.frames.*.size.width/height`가 positive number인가?
- `tilemap.tiles`의 key가 positive integer string이고 `frame`이 `atlas.frames`를 참조하는가?
- `tilemap.tiles.*.color`가 `[r,g,b,a]` 형태의 `0..1` 숫자 네 개인가?
- `tilemap.layers.*.columns/rows`와 `data` 길이(`columns * rows`)가 일치하는가?
- `tilemap.layers.*.collision`이 boolean이고, 충돌을 의도한 layer에만 `true`인가?
- `tilemap.layers.*.data`의 양수 tile id가 `tilemap.tiles`에 존재하는가?
- chase enemy 우회를 기대한다면 `collision: true` layer가 player/enemy 위치를 포함하는 grid 범위와 빈 통로를 제공하는가?
- 같은 prefab에 `frame`과 `animation`을 동시에 지정하지 않았는가?
- `prefabs.*.animation.frames`가 1보다 크면 `fps`가 함께 제공되는가?
- `prefabs.*.animation.states`를 쓰면 `columns`, `rows`, `states.idle`이 제공되고 state frame 수가 column 수를 넘지 않는가?
- `pnpm validate:game-spec`를 실행했는가?
- tilemap, wave, atlas, audio policy를 건드렸다면 `pnpm smoke:headless`를 실행했는가?
- 의도한 난이도 변화가 문서나 응답에 설명되었는가?

## Schema/Validator 변경

- `docs/game-spec.md`가 새 필드를 설명하는가?
- `schemas/shooter-game-spec.schema.json`가 새 필드를 반영하는가?
- `packages/ferrum-web/src/gameSpec.ts`가 기본값, 검증, 에러 메시지를 제공하는가?
- JSON Schema는 구조 보조용이고 최종 기본값/교차 필드 검증 기준은 `resolveShooterGameSpec(...)`임을 문서가 설명하는가?
- `packages/ferrum-web/test/gameSpec.test.ts`에 성공/실패 케이스가 있는가?
- `pnpm lint`와 `pnpm test:web`이 통과했는가?

## Rust/Wasm 변경

- Rust가 원본 JSON/string object를 받지 않는가?
- Wasm API가 프레임 hot path에서 entity별 호출을 만들지 않는가?
- `packages/ferrum-web/src/wasm.d.ts`와 generated `packages/ferrum-web/pkg/ferrum_core.d.ts`가 동기화되었는가?
- `cargo fmt`, `cargo clippy`, `cargo test`가 통과했는가?
- Wasm 변경 후 `pnpm build`가 통과했는가?

## 문서 변경

- README에 사용자-facing 사용법이 있는가?
- `docs/architecture.md`가 Rust/TS 경계를 설명하는가?
- 현재 단계 문서가 **MVP 개발 완료, 상용제품 기능 개발** 상태와 검증 명령을 반영하는가?
- package entrypoint, `exports`, `files` 정책을 바꿨다면 `docs/public-api.md`와 `pnpm package:check`가 함께 갱신되었는가?
- 별도 설계/승인 없는 제품 제외 범위(WebGPU, Worker, editor, multiplayer 등)를 위반하지 않았는가?

## 최종 보고

- 변경 파일 요약
- 각 변경의 이유
- 실행한 명령 목록과 결과
- 실행하지 못한 명령과 사유
- 리스크 또는 후속 작업
