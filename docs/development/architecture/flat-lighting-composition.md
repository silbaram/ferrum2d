# Flat 2D 조명 합성

상태: 개발 소스의 M2-a opt-in lit 및 M3b Flat HDR·M4b Surface 구현. 기존 overlay는 기본값으로 유지한다.
SDK와 함께 빌드한 sprite lighting v1 Wasm이 필요하며 기존 배포 버전의 지원으로 간주하지 않는다.
현재 사용 계약은 [화면 표현](../../engine/data-scene-presentation.md#flat-점광원의-차폐-합성)을 따른다.

## 두 profile의 의미

| 항목 | 현재 legacy overlay | opt-in lit 수신 표면 합성 |
| --- | --- | --- |
| 표면색 | 기존 화면 위에 광원 RGB를 더함 | 표면의 선형 albedo에 조도를 곱함 |
| ambient | RGBA 색 overlay. 검은색 alpha는 기존 화면을 어둡게 함 | 선형 RGB 조도. overlay alpha를 조도로 자동 재해석하지 않음 |
| 차폐 | 해당 광원의 기여만 RGB transmission으로 감쇠 | 같은 광원별 visibility를 재사용. ambient·다른 광원 보존 |
| 빈 배경·투명 구멍 | 전체 화면 조명에 반응 가능 | receiver coverage가 없는 곳은 장면 배경 유지 |
| `unlit` 이름 | 기본 sprite 색/블렌드 프리셋. 후단 조명 제외를 뜻하지 않음 | 별도의 명시적 수광 제외가 필요. 이름으로 추측하지 않음 |
| HUD | 호스트가 조명 이후 그리면 제외 가능 | 명시적 수광 제외 또는 별도 후단 pass로 보존 |
| 기존 씬 | 현재 외관·저장 의미 유지 | 새 profile을 명시한 씬에서만 선택 |

검은 표면이 밝아지는 현재 결과를 기존 계약의 버그로 처리하지 않는다. 새로운 합성의 필요성을 재현한 기준선이다.

## M2-a의 수학과 색공간

opaque 수신면의 초기 식은 다음과 같다. 연산은 채널별이며 최종 표시 변환 전 선형 공간에서 수행한다.

```
B = decode_sRGB(colorTexture.rgb) × linearTint.rgb
I = ambientIrradiance + Σ(lightColor × intensity × attenuation × normalResponse × visibilityRGB)
C = B × I
```

- 색 텍스처의 sRGB decode는 한 번만 한다. `linear` 자산은 재해석하지 않고 data/normal/mask에는 색 변환을 하지 않는다.
- 새 lit의 색 자산은 `loadTexture(..., {alphaMode:"straight"})`로 준비한다. 현재 WebGL2 legacy sRGB의 premultiplied 업로드 자산을
  그대로 straight RGB로 해석하지 않는다. renderer의 `prepareFlatLighting`을 authoring의 `flatLightingPreparer`로 전달하며, apply/restore는 활성화 전에 자산과 capability를 검사한다.
- tint·광원·ambient의 조도 계수는 새 profile의 선형 값이다. 기존 legacy overlay 값을 무조건 이 식에 옮기지 않는다.
- 점광원 color alpha는 기존처럼 해당 광원의 세기에 포함한다. 그림자 mask의 alpha와 receiver alpha를 혼동하지 않는다.
- 노멀 미지정 수신면의 기준은 화면 앞쪽 `+Z`다. 광원 높이·방향과 내적하고 0 아래를 자른다.
  현재 unmapped overlay의 응답 1과 다르므로 기존 모드에 소급하지 않는다. atlas·회전·flip 변환은 기존 normal 계약을 재사용한다.
- RGB visibility는 해당 광원에만 곱한다. 같은 차폐물이 겹쳐도 union mask이며 반복해서 장면색을 어둡게 하지 않는다.
- 최종 sRGB encode는 출력 경로에 맞춰 한 번만 한다. 초기 M2-a는 SDR 출력이며 밝기가 1을 넘는 에너지 보존은 M3b HDR 범위다.
- 전역 `linear-srgb`와 lit 내부 선형 연산은 서로 다른 선택이다. 전역 모드도 양 backend를 지원하며
  실제 GPU 경로의 성공을 확인한다. fallback을 필수 WebGPU 검증의 성공으로 세지 않는다.

수치 벡터는 `tests/smoke/flat-lighting-reference-vectors.json`에 둔다. 동일 sRGB 표면에 ambient 조도 0.5와
백색 직접광 조도 0.125를 주면 목표 출력은 다음과 같다. 실제 lit GPU smoke는 이 값에 대한 색 오차 3 이하를 검사한다.

| sRGB 표면 byte | 목표 선형 계산 | 목표 sRGB 출력 byte |
| --- | --- | --- |
| 0 | `decode(0) × 0.625` | 0 |
| 96 | `decode(96/255) × 0.625` | 76 |
| 255 | `1 × 0.625` | 207 |

같은 입력의 **현재 legacy 색공간**에서 검은 ambient alpha 0.5 뒤 `white RGB 0.25 × intensity 0.5`를 더하면
약 32/80/160이다. WebGL2의 현재 전역 linear 모드는 텍스처를 decode한 뒤 overlay를 합성하므로 별도 기준으로 검사한다.
서로 다른 색공간 모드를 같은 픽셀값이어야 하는 backend parity로 취급하지 않는다.

## Receiver·alpha·HUD 경계

- 초기 lit 수신 대상은 명시한 opaque와 cutout이다. cutout은 작성한 alpha cutoff로 discard/opaque coverage를 결정한다.
  discard된 픽셀은 빛을 더하지 않으며 그 아래 표면/배경을 보존한다.
- 반투명 다중 layer의 정상적인 광학 합성과 additive 발광은 초기 수광 범위에서 제외한다.
  해당 객체는 명시적 수광 제외 후 별도 pass로 표시한다. 지원하지 않는 receiver 조합은 장면 활성화 전에 진단으로 거절한다.
- receiver 선택은 collider·layer 이름·normalTexture 존재 여부·프리셋의 `unlit` 문자열로 자동 추론하지 않는다.
  caster 선택과 receiver 선택도 별개다. Rust의 정렬된 command와 정합하는 선택 sidecar가 필요하면 version/stride/길이·범위를 명시한다.
- Rust가 동적 객체의 pose·정렬·수광 분류를 소유하고 TS는 cold 검증과 GPU 합성을 담당한다.
  기존 15-float command를 무계약으로 확장하거나 entity별 frame Wasm 호출을 추가하지 않는다.
- HUD/수광 제외 객체의 색과 alpha는 조명 ON/OFF에서 같아야 한다. 이미 합성한 장면을 다음 광원의 albedo로 재사용하면 안 된다.
  후단 HUD 경계는 현재도 `setLighting(false)` 이후 별도 command 제출로 검증한다.
  한 프레임 안에서 `장면 command → 조명 OFF → HUD command → renderPostProcess()` 순서를 지킨다.
  최종 표시 변환이 끝난 뒤 HUD를 추가 제출하는 순서는 이 검증의 대상이 아니다.

## 실행 가능한 기준선

```bash
pnpm smoke:flat-lighting-contract
```

이 명령은 SDK를 빌드하고 다음을 실제 readback으로 검사한다.

- WebGL2/WebGPU의 legacy × DPR1/2, WebGL2 linear-sRGB × DPR1/2: 총 6조합.
- 검은/회색/흰 실제 색 텍스처, 빈 배경, alpha 0/255/128 텍스처의 기존 출력.
- 기본 unlit 프리셋에서도 후단 ambient/sun이 적용되는 현재 의미.
- 빨간 광원 A만 차폐할 때 파란 B·ambient 보존, 반투명 mask의 중복 차폐 union.
- 후단 HUD의 색 보존, OFF의 byte 단위 framebuffer 복귀, 비활성 추가 pass/target 없음과 warm 자원 plateau·destroy 회수.
- 동일 legacy 조합의 고정 receiver RGB 오차 3 이하. GL linear는 독립적인 decode/blend/encode 수치와 비교.

반투명 alpha128 샘플은 현행 backend별 호환 계약을 별도로 검사한다. WebGL2 legacy sRGB는 업로드된 RGB가
premultiplied이며 WebGPU와 WebGL2 linear는 straight다([공개 설명](../../engine/public-api/labs.md)).
따라서 같은 샘플의 기존 출력 차이를 오류로 바꾸거나 공통 parity의 성공으로 세지 않는다. 기준 clear `[16,24,32]`에
blue/alpha128을 겹치면 legacy GL RGB는 약 `[8,12,80]`, GPU RGB는 `[8,12,144]`다.
기준선은 이 샘플의 base/ambient/sun RGBA를 backend별 수식으로 검사한다. GL legacy의 alpha는 각각 약
191/159/223이고, GPU·GL linear는 불투명 배경 위에서 255다. HUD 픽셀도 RGB와 alpha를 함께 검사한다.
불투명·cutout/빈 배경의 나머지 6개 수신점은 원래 RGB 값으로 비교한다. 반투명 픽셀은 건너뛰지 않고
모든 상태에서 업로드 차이를 보정한 별도 RGB 비교를 한다. 두 backend의 blue 차이는 조명 OFF 약 63.75byte,
검정 ambient alpha0.5 이후 약 31.87byte다. 같은 additive 빛은 차이에서 상쇄된다. 차이를 보정하는 blue 채널의 포화 부재도 검사한다.
보고서는 원래 RGB 비교와 보정 비교의 관측/예상 차이·오차를 분리한다.

CPU submit 시간은 호출 구간만 기록하고 GPU 시간은 미측정 `null`이다. draw에는 최종 표시 pass도 포함한다.
HUD의 두 command 제출은 각각의 통계를 보관하고 전체 draw를 합산한다. target/bytes도 실제 통계에서 수집하며
소프트웨어 GPU 결과를 모바일 FPS나 실제 GPU 시간 보장으로 해석하지 않는다.
보고서는 `artifacts/flat-lighting-contract/verification.json`과 고유 run 디렉터리에 저장한다.
probe 실패 시에도 `ok:false`, 직전 제출 `failure.stage`, 원인, 완료된 상태·관측값과 cleanup 결과를 반환한다.
호출자는 실패 결과를 먼저 보고서에 넣은 뒤 실행을 실패 처리한다. cleanup은 원래 오류를 보존하면서
renderer·capture target·canvas의 해제를 각각 시도한다. renderer를 만들지 못한 경우 자원 수를 0으로 위장하지 않는다.
검증용 GL readback 오류 4개는 정상 실행과 분리한다: 두 번째 읽기 실패, HUD alpha 손상, 반투명 sun RGB 손상,
반투명 point RGB 손상이다. 앞의 세 오류는 probe에서, 마지막은 backend 보정 비교에서 거절해야 한다.
오류 주입이 정확히 한 번 작동했는지, 부분 측정값이 남는지, 실패 후에도 자원이 회수되는지 검사한다.

기존 baseline 보고서의 새 lit 수치 벡터는 `design-reference-only`, `renderedByEngine:false`로 별도 기록한다.
실제 새 경로의 검증은 `pnpm smoke:flat-lit`과 분리한다.
참조 벡터 검산이 새 렌더 경로의 GPU 검증을 대신하지 않는다.

CI의 수동 `workflow_dispatch` validate job에서 해당 명령을 실행한다. 일반 push/PR trigger를 새로 추가하지 않는다.

## 구현 경계와 비용

Rust는 명시적 수광 metadata를 world/snapshot/prototype에 보관하고 sprite 정렬 후 command와 같은 순서로 내보낸다.
선택형 v1 sidecar는 8-byte `repr(C)` record `[mode:u32, alphaCutoff:f32]`다. 기존 15-float command ABI는 유지한다.
전체가 unlit인 프레임은 sidecar를 생략한다. JS는 프레임당 bulk view를 읽고 GPU staging만 작성한다.

TS는 원래 색상 draw, normal/coverage/weighted-albedo의 3 MRT, RGBA16F 조도 누적,
기존 수광 색 제거와 새 기여 추가의 2 fullscreen pass를 소유한다. 합성은 RGB만 쓰므로 원래 목적지 alpha는 유지한다.
명시적 unlit 전경은 아래 수광 기여를 source-over alpha로 가린다. 임의의 여러 반투명 수광층을 정확히 따로 조명하는 경로는 아니다.
receiver는 opaque/cutout만 지원한다. primitive/tile/particle/text는 초기 수광 대상이 아니다.

활성 scratch는 physical pixel당20 bytes(3×RGBA8 + RGBA16F)이며 광원별/태양 차폐 mask는 별도다.
활성 receiver가 없거나 `{profile:"lit", enabled:false}`이면 추가 data/lighting/composite pass와 scratch target은 없다.
컴파일한 program/buffer는 재사용한다. global linear-sRGB의 표시 target 비용은 별도다.
GL은 `EXT_color_buffer_float`와 3 draw buffer를 요구한다. WebGPU는 실제 backend로 검증한다.
새 profile은 base alpha sprite material만 지원하며 colorMix/palette/outline/additive 및 Spatial과의 결합은 사전에 거절한다.

`pnpm smoke:flat-lit`은 양 backend와 GL linear-sRGB를 DPR1/2에서 실제 readback한다.
검은/회색/흰 albedo, cutout/opaque/unlit, unlit 반투명 전경, 두 광원의 차폐, HUD,
OFF identity/비용, warm 자원 plateau, resize 복귀와 WebGPU device recovery를 검사한다.
실패 단계·부분 상태·destroy 후 자원을 `artifacts/flat-lit-m2a/gpu-*/verification.json`에 남긴다.
CPU 값은 submit+완료대기+readback 시간이며 실제 GPU timer나 FPS 보장이 아니다.

Spatial의 선택형 성분 분리·효과 순서는 [별도 합성 계약](spatial-lighting-composition.md)을 따른다.
실게임·실기기 예산은 [조명 품질 계획](../../planning/lighting-quality-upgrade-plan.md)의 개발 완료 후 검증 범위다.


## 선택형 Flat HDR 출력

`LightingScene2D.hdr`의 공개 필드·실행 순서는 [Flat HDR](../../engine/data-scene-presentation.md#flat-hdr-개발-소스)에 정의한다.
공유 정규화와 전환 검사는 `flatHdr.ts`, 셰이더는 `flatHdrShaders.ts`, 자원은 backend별 HDR pass가 소유한다.
Rust simulation, public15-float command와 sprite lighting v1 sidecar는 바꾸지 않는다.
private17-float GPU staging의 bit2(값4)는 source 수동 sRGB decode, bit3(값8)는 HDR 선형 출력을 구별한다.
기존의 크기 비교 대신 독립 bit 검사로 normal/data source에 잘못 decode하는 일을 막는다.

원래 flat lit은 SDR target과 3×RGBA8 + RGBA16F scratch를 유지한다.
HDR은 원래 색·normal/coverage pass 구조를 재사용하되 albedo도 float16으로 저장해 어두운 색의 양자화 손실을 막고,
색·수광 기여를 별도 float16 월드 target에 합성한다. 월드는 여러 command 호출을 가로질러 유지한다.
`setLighting(false)` 또는 최종 `renderPostProcess()`가 원래 표시/전역 후처리 target에 resolve한다.
노출→톤매핑→표시 transfer는 한 번이며 GL 전역 linear 모드에서는 기존 최종 fullscreen이 transfer를 담당한다.
HDR의 alpha는 선형 premultiplied 누적 후 straight RGB를 변환하고 다시 premultiply한다.

설정/packet 검증은 월드 clear/resolve 전 수행한다. 활성 월드의 출력 설정 변경과 SDR 이후 HDR 활성화는 거절한다.
HDR OFF는 target을 해제하고 program/buffer는 재사용한다. 새 프레임, resize, pixelPerfect와 device recovery는
기존 renderer lifecycle을 따른다. 새 target 교체 실패는 이전 target을 유지하고 부분 할당을 회수한다.
HDR output draw는 HUD 제출이 통계를 초기화해도 프레임별 별도 누적값으로 유지한다.

추가 비용은 HDR world8 bytes/pixel, HDR albedo의 SDR 대비 증가4 bytes/pixel, 출력1 draw다.
전체 수광 scratch는24 bytes/pixel이며 world와 합계32다. mask·후처리·presentation은 별도다.
비활성 profile에서 HDR target/pass를 만들지 않는다. GPU format별 pipeline과 debug line pipeline은 선택 시 생성한다.

`flat-hdr-browser-fixture.mjs`는 양 backend/GL linear × DPR1/2에서 radiance2/4,
어두운 albedo, exposure, Reinhard/ACES/none, source/data·tint·normal/cutout, 반투명 전경·투명 canvas,
여러 world 제출, HUD, invalid atomicity, OFF identity/자원, warm plateau, resize·pixelPerfect·복구·destroy를 검사한다.
기존 `smoke:flat-lit`과 CI validate job이 이 fixture를 실행하며 software GPU를 실물 성능으로 주장하지 않는다.


## 선택형 Flat Surface

`SpriteSurfaceMaterial`은 별도40-byte `repr(C)` sidecar이며 기존 sprite15/lighting8을 유지한다.
원자적 bulk 설정, world lifetime·snapshot·actor prototype과 정렬 후 command alignment는 Rust가 소유한다.
flags0 canonical defaults는 생성된 shadow/text/tile/particle command와 정렬 간격에도 채운다.
전체 미선택 프레임은 sidecar 길이0이다. world의 optional component vector 저장 공간은 별도이며,
비활성 GPU pass/target0을 native 메모리 비용0으로 해석하지 않는다. JS는 프레임당 bulk u32/f32 alias를 읽고 deferred callback에서 함께 복사한다.

플랫폼의 Surface data variant만 private24-float instance staging을 사용한다. emissionRGB/specular/roughness·map flags를
17-float lighting prefix 뒤에 두며 entity별 Wasm 호출이나 simulation 상태를 추가하지 않는다.
map ID 조합별로 batch를 나누고 WebGPU는 view identity 기반 WeakMap으로 bind group을 재사용한다.
새 map view는 재import를 무효화하며 옛 자산을 별도 강한 cache에 보관하지 않는다.
GL의 map은 unit2/3/4, GPU는 별도group3의 raw nearest textureLoad를 사용한다.
GL managed의 hardware decode와 GPU raw view의 shader decode를 구분해 emission sRGB를 한 번만 변환한다.

네 번째 MRT는 RGBA16F emission이다. coverage RGB를 specular/receiverCoverage/roughness로 사용하고,
전체 sprite coverage는 normal.a에서 읽는다. Surface variant의 normal alpha blend는 별도 source-over alpha다.
수광 albedo에 direct Lambert와 bounded GGX를 계산한 결과는 기존 조도 target에 합산한다.
ambient는 albedo만 쓰고 emission은 광원/shadow와 독립적으로 composite에서 더한다.
기존 subtract/add는 동일한 coverage로 원래 base 기여를 제거·교체하고 destination alpha를 유지한다.
추가 비용·공개 제약은 [재질 계약](../../engine/data-scene-presentation.md#flat-sprite-표면-재질-개발-소스)에 정의한다.

renderer는 SDR/HDR × 기본/Surface의 네 lazy pass를 소유한다. 매 프레임 실제 사용 bitset을 유지해
여러 renderCommands에서 기본/Surface variant가 번갈아 나와도 warm target을 다시 할당하지 않는다.
프레임 종료와 다음 프레임 시작에 미사용 target을 회수하고 disabled·destroy·device recovery에서도 함께 정리한다.

Surface의 `textureBindCount`는 기존 implied-batch 통계에 data batch당 map3개와 고정 albedo/emission2개를 더한다.
실제 API state restore 호출을 전부 세는 GPU profiler가 아니며 target bytes·실제 draw·map sample 비용과 함께 판정한다.


## 독립 수신 mask

Rust는 별도 v1/8-byte `SpriteLightMasks` sidecar와 cold v2 combined receiver setter를 소유한다.
기존 receiver8 및 Surface40의 예약 영역을 재사용하지 않는다. v2 요청은6-u32
`[id,generation,mode,cutoffBits,lightMask,shadowMask]`이며 전체를 검사한 뒤 receiver/mask/Surface 상태를 바꾼다.
기존4-word setter는 mask를255/255로 되돌리고 unlit 해제는 Surface도 함께 해제한다.
world/prototype/snapshot·despawn 재사용·정렬과 shadow/text/tile/particle 간격은 native가 관리한다.

TS는 header/size/ptr/count·byte 범위와 receiver/profile 정합성을 검증하고 u32 pair를 bulk로 읽는다.
mask identity draw만 private19-float staging을 사용한다. 기존15-float geometry/17-float receiver prefix 뒤에 두 채널을 둔다.
base alpha는 분기 전에 샘플링하고 cutout을 discard한다. unlit command는 identity를 바꾸지 않으며,
기존 normal/coverage/albedo pass가 전경 alpha와 receiver coverage를 계산한다.

RGBA8 raw identity target의 R/G를 반올림해8-bit 채널로 읽는다. 직접광의 light intersection과 shadow intersection을 따로 계산한다.
GL은 unit5 및 두 채널 uniform, GPU는 normal group의 추가 view와 private14-float light instance를 사용한다.
기존13-float light prefix 뒤의 추가 float에는 light8bits/shadow8bits/identity-view-presence1bit를 저장한다.
기본 packet은 coverage view를 binding placeholder로 재사용하며 identity texture를 읽지 않는다.
별도 target·draw는 custom receiver가 있을 때만 생성한다. Surface4MRT에 다섯 번째 attachment를 요구하지 않는다.

renderer는 기존 variant 사용 bitset과 별도의 mask 사용 bitset으로 여러 packet의 warm target을 재사용한다.
프레임 종료에 사용하지 않은 identity target을 해제하고 프로그램/버퍼는 보존한다. 복구는 기존 backend/asset 재생성을 따른다.
추가 texture4 bytes/pixel와 data draw·bind는 기존 resource/renderer 통계에 포함한다.

## 선택형 Flat point cone

선택형 `PointLight2D.spot`의 source 검증·정규화는 `lightingSpot`이 담당한다.
`dataSceneView`는 투영 전에 방향을 정규화하고 Y축 압축을 적용한다. 렌더러는 타원 범위의 Y 비율을
다시 반영하여 양 backend가 같은 방향·개구각·penumbra를 사용하게 한다. source 설정과 표시 파생값을 구분한다.
행동 상태나 Native render/material ABI를 추가하지 않는다.

WebGL2의 기존 point pass는 vec4 `[axisX,axisY,cosOuter,cosInner]`를 소비한다.
WebGPU는 legacy14-float instance row를 보존하고 lit row만18 float로 확장한다.
기존 rect/color/light/mode/channel prefix14는 유지하며 마지막4가 cone이다.
cosOuter=-2는 미선택 또는360도 hard 원형의 명시적 sentinel이다. point 직접 성분의 alpha에
원뿔 감쇠를 곱하므로 diffuse와 bounded reflection을 함께 제한한다. ambient/emission·수신 mask·광원별 shadow 합성은 유지한다.
정점·sprite lighting·Surface·receiver mask의 Native ABI는 변경하지 않는다.

## 선택형 Flat cookie

cookie source의 strict 검증과 이름→ID 해석은 `lightingCookie`의 cold 경로다. 원본 문서는 이름·OFF·명시적0을
보존하고 renderer는 loaded straight-alpha data 이미지와 cookie v1 capability를 확인한다. 프레임의
`view.lighting`은 이름을 현재 registry에 해석한 뒤 기존 world→logical 타원 변환을 적용한다.
시뮬레이션이나 entity별 Wasm 호출은 추가하지 않는다. 수신점의 타원 정규화 좌표를 역회전하고 atlas로 옮겨
raw nearest R*A를 읽는다. 적용 위치는 해당 point의 직접광 alpha이며 diffuse/GGX를 함께 제한한다.

GL은 unit6 texture/sampler를 저장·복원하고 cookie가 없을 때 sampler uniform은 unit0을 가리킨다.
외부 unit6의 불완전 texture·mip sampler가 기본 draw의 validation을 깨지 않게 한다.
GPU는 별도 group3 texture+dynamic uniform을 cookie shader variant에만 추가한다. private legacy14/lit18 row와
기존 group0/normal1/shadow2는 유지하며, 미사용 group slot은 빈 layout이다.
8 KiB 테이블에32개256-byte row를 먼저 업로드하고 direct draw의 동적 offset으로 서로 다른 UV/회전을 선택한다.
동일 texture view는 한 bind group을 재사용하고 퇴역 view는 다음 preparation에서 cache에서 제거한다.
plain 연속 광원은 계속 batch한다. cookie direct draw만 광원별로 나누며 shadow·ambient·composite pass 구조는 유지한다.
`textureBindCount`는 기존 implied 통계에 활성 cookie 광원의 data binding을 각각1개 더한다. 실제 상태 복원 API 호출을 세는 값은 아니다.

각 lit pass variant에 테이블1개와 normal/masked 조합별 lazy shader를 최대4개 보관한다.
OFF는 추가 draw/target이 없으며 warm 테이블의8 KiB는 destroy/recovery까지 유지할 수 있다.
동기 group/write 실패는 partial cache를 지워 재시도를 허용한다. 비동기 GPU allocation/validation 실패는
버퍼를 회수하고 오류를 고정해 다음 preparation에 전달한다. destroy 뒤 scope 완료는 자원을 다시 건드리지 않는다.
원본·좌표·비용 범위는 [공개 cookie 계약](../../engine/data-scene-presentation.md#flat-2d-cookie-조명-개발-소스)을 따른다.

## 선택형 Flat convex polygon

`lightingPolygons`는3..8 꼭짓점·최대256개 도형의 raw/f32 strict convex·shape·좌표/광원/투영 한도를 검사한다.
각 edge에 대해 다른 모든 점의 반평면을 검사하므로 local turn만 같은 self-intersecting star도 거절한다.
resolve cache의 warm match는 필드 형태도 검사한다. 반환 값과 geometry cache는 원본 꼭짓점과 분리된 소유 복사본이다.
부분 검증 실패는 활성 renderer 씬을 교체하지 않으며 cold authoring에는 별도 polygon v1 capability를 요구한다.

`lightingPolygonShadows`는 타원 거리로 가장 가까운 edge를 cull하고, 내부/경계 광원은 기존 사각형 정책처럼 제외한다.
원본 body와 두 각도 접선을 유한 extrusion한 끝점의 convex hull은 최대10개 vertex다. 기존 rectangle clip helper가
최대4개 교차점을 추가하므로 XY 출력은72 float로 제한한다. 기존 사각형 투영 함수와36-float 상한은 유지한다.
`LightingShadowGeometryCache`는 두 도형의 deep snapshot·joint revision으로 광원별 위치/반경/투영/clip 캐시를 갱신한다.
실제 Flat 합성용 effective scene에도 polygon 배열을 전달하고 생략할 때 해제해 이전 도형을 재사용하지 않는다.

두 backend는 기존 광원별 union mask와 shadow staging을 사용한다. 새 target·shader·Native record는 없다.
정적 CPU geometry는 재사용하지만 기존 GL `bufferSubData`와 GPU shadow `writeBuffer`/mask draw는 계속 수행한다.
M5의 shadow 예산·정적 upload 최적화와 구분한다. 모든 한도를 함께 쓰면 광원별 XY cache는 최대55,296 float이며
2의 거듭제곱 용량으로 최대256 KiB를 유지한다. GL은 한 shadow vertex 버퍼를 재사용하고, WebGPU의10-float shadow
vertex staging은 광원별 구간을 한 버퍼로 합치므로32개 광원의 최악 용량은 CPU/GPU 각각64 MiB까지 증가할 수 있다.
실제 bytes는 renderer resource 통계와 함께 검사하며 이를 실기기 성능 보장으로 해석하지 않는다.
[공개 도형 계약](../../engine/data-scene-presentation.md#flat-볼록-다각형-차폐-개발-소스)을 따른다.
