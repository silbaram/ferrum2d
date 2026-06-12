# Smoke 테스트

`tests/smoke/`는 Ferrum2D engine/package/example이 실제 runtime 경로에서 깨지지 않는지 검증하는 test harness를 둔다.

이 디렉터리의 스크립트는 production runtime 코드가 아니며, root `package.json`의 `smoke:*`, `validate:*`, `package:consumer-smoke` 명령에서 실행된다.

대표 항목:

| 스크립트 | 용도 |
| --- | --- |
| `browser-render-smoke.mjs` | built example `dist`를 로컬 서버와 Playwright Chromium으로 열어 canvas/render/UI/runtime budget을 검증 |
| `level-streaming-browser-smoke.mjs` | built `ferrum-web` WebGL2 renderer에서 chunk 이동, asset release, draw call/texture switch/runtime budget을 검증 |
| `headless-smoke.mjs` | Wasm Top-down Shooter render command와 scene state를 headless로 검증 |
| `gameplay-replay-smoke.mjs` | committed gameplay golden replay fixture와 deterministic replay hash 검증 |
| `runtime-budget-profiles.mjs` | browser smoke runtime budget profile 정의 |
