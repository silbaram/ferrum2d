# 공용 VFX 리소스와 실행 기능 고도화 계획

기준일: 2026-11-09

상태: Ferrum2D VX 단계는 미착수. 독립 Studio는 첨부 계획서상 v0.2 개발 진행 중이며 구현 재현 검증은 별도다.

다음 착수: **VX-00 — 최소 출력 계약과 실제 Ferrum2D 연동 검증**, 이후 VX-01 공용 리소스화

## 목표

게임 프로젝트가 불꽃·먼지·잔상을 매번 직접 작성하지 않고, 엔진이 제공하는 효과 리소스를 불러와
위치·대상·강도 등을 지정해 재생할 수 있도록 한다. AI agent가 효과 데이터를 작성·검증하고,
기능 실험실에서 같은 리소스를 직접 비교할 수 있어야 한다.

현재 제공하는 입자 계산·방출기·이벤트 전달을 재사용한다. 이번 계획은 재사용과 게임 연동을 먼저 다루고,
방출 형태·입자 표현의 확장은 별도 단계로 진행한다. 문서의 신규 계약·동작은 설계 제안이며 현재 지원 API가 아니다.
독립 제작 도구가 출력한 atlas 애니메이션을 소비하는 경로도 포함한다. 제작 도구의 편집 기능과 엔진의 실행 기능은 별도 책임으로 관리한다.

현재 사용법은 [기능 지도](../engine/showcase-hub.md),
이벤트 경계는 [Runtime Extensibility](../engine/runtime-extensibility.md),
검증 기준은 [Smoke Check](../development/quality/smoke-check.md)를 따른다.

## 외부 엔진 조사

공식 문서에서 확인한 제공 방식과 Ferrum2D에 적용할 판단을 구분한다.
아래 자료의 개념을 참고하며 외부 엔진 코드·에셋을 복사하는 계획은 포함하지 않는다.

| 대상 | 공식 문서에서 확인한 방식 | 적용할 판단 |
| --- | --- | --- |
| Unreal Engine | Niagara가 System·Emitter·Module·Parameter를 조합하고 CPU/GPU 실행과 에셋 관리를 지원한다. [Niagara 개요](https://dev.epicgames.com/documentation/en-us/unreal-engine/overview-of-niagara-effects-for-unreal-engine), [Emitter 설정](https://dev.epicgames.com/documentation/en-us/unreal-engine/emitter-settings-reference-for-niagara-effects-in-unreal-engine) | 효과 하나에 필요한 표현을 재사용 가능한 리소스로 묶는다. 초기 복합 효과는 기존 이벤트·리소스 참조를 조합한다. |
| Unity | Particle System은 모듈·속성으로 제작하고, VFX Graph는 GPU 효과를 그래프로 작성한다. 코드에서 재생과 파라미터를 제어한다. [공식 비교](https://docs.unity.com/en-us/engine/6000.3/manual/visual-effects/particle-systems/choosing-your-particle-system) | 효과 정의와 실행 인스턴스를 구분하고, 같은 정의를 여러 위치에서 독립적으로 사용한다. |
| Godot | GPU 입자는 ParticleProcessMaterial 리소스로, CPU 입자는 노드 속성으로 설정한다. 크기·색 등의 수명별 변화도 지원한다. [2D 입자](https://docs.godotengine.org/en/stable/tutorials/2d/particle_systems_2d.html), [ParticleProcessMaterial](https://docs.godotengine.org/en/stable/classes/class_particleprocessmaterial.html) | JSON으로 작성·검증하기 쉬운 효과 리소스와 명시적인 기본값·에셋 참조를 우선한다. |
| three.js | Points·재질·셰이더 등으로 표현을 구성한다. GPUComputationRenderer 추가 모듈과 WebGPU compute 파티클 예제도 제공한다. [Points](https://threejs.org/docs/pages/Points.html), [GPU 계산 모듈](https://threejs.org/docs/pages/GPUComputationRenderer.html), [WebGPU 예제](https://threejs.org/examples/webgpu_compute_particles.html) | 계산·렌더링 경계를 유지하고, 작은 기능 예제와 성능·정리 검증을 함께 제공한다. |

공통적으로 실행 기반과 효과 제작 데이터를 구분한다. 완성된 효과 콘텐츠의 포함 범위는 샘플·프로젝트·추가 패키지에 따라 다르다.
Ferrum2D에서는 자체 제작한 세 효과를 공용 리소스로 정비하는 것부터 시작한다.
GPU 렌더러 지원과 GPU 입자 시뮬레이션은 별도 기능으로 취급한다.
Unity VFX Graph도 compute shader 지원 플랫폼을 전제로 한다. Ferrum2D는 기본 WebGL2 경로와 fallback을 유지하며,
WebGPU 렌더러 지원만으로 기존 Rust 입자 계산이 GPU 시뮬레이션으로 바뀌는 것으로 해석하지 않는다.

## 현재 Ferrum2D 기준선

| 이미 있는 기능 | 코드 근거 | 이번 계획에서 보강할 경계 |
| --- | --- | --- |
| 입자의 생성·이동·감쇠·크기/색 보간·수명·렌더 명령 | `crates/ferrum-core/src/particles.rs` | 기본 계산을 재구현하지 않는다. 표현 확장 단계에서 필요한 부분만 변경한다. |
| 입자 설정 등록·일괄 방출·전체 정리·seed·수용량 조회 | `packages/ferrum-web/src/engineTypes/api.ts`, `particlePreset.ts` | 공용 리소스의 등록·검증과 개별 효과의 소유권을 정한다. |
| burst·loop·trail 방출기, start·stop·reset, 설정 범위 검증 | `packages/ferrum-web/src/particleVfx.ts`, `/labs` export | 기존 API를 재사용하고 제품용 리소스·인스턴스 계약을 정비한다. |
| 기본 프리셋 hit-spark·dust-loop·motion-trail | `particleVfx.ts` | 기존 기본값을 사용하는 게임의 호환성을 유지한다. |
| 예제 전용 이미지·개선된 기본값·나란히 비교 | `examples/starter-runtime/src/featureParticles.ts`, `public/playground/particle-*.png` | 게임 프로젝트가 예제 내부 파일에 의존하지 않고 사용할 수 있게 한다. |
| 효과 이름과 숫자 id 연결, audio/particle/camera/custom dispatch | `presentationEffects.ts`, `effectEventRuntime.ts`, `effectEventAdapters.ts` | 기존 이벤트 파이프라인과 공용 VFX 리소스의 연결·수명을 보강한다. |

현재 `ParticlePresetConfig`에는 이미지/UV·수량·수명·속도·시작/종료 크기·색·가속도·감쇠가 있다.
입자별 회전·프레임 애니메이션·변화 곡선과 방출 형태를 이미 제공하는 것으로 표기하지 않는다.
전체 정리용 `clearParticles()`와 게임에서 필요한 개별 효과 정리는 다른 계약이다.

## 진행 중인 독립 Studio 계획과 연결

검토 자료는 `VFX 생성 도구 개발계획.docx`다. 기준 구현은 v0.2/2026-11-05이며,
2026-11-06에 추가한 게임 시점·옵션 편집·AI 적용 목표를 포함한다.
해당 Word 문서의 SHA-256은 `6afbca7b6a39291757614903e67aaaf8701098ebf003764b6de7436c1f75a0a6`이다.

독립 Studio의 구현·검증 상태는 첨부 문서의 보고이며, 엔진 연동 완료의 근거로 사용하지 않는다.
구현 ZIP과 PDF 원문이 제공되지 않아 실제 구현과 연동은 VX-00에서 별도로 재현 검증한다.
문서의 Ferrum2D 계약 검사 기준은 `3f023427208f7a04eacc7dea3d402df7e13dc451`이며 native 호출은 mock이다.
검토 시 엔진 기준은 `9dc5319`와 로컬 변경이므로, 연동 시 실제 package 버전·commit·로컬 변경 식별자를 다시 기록한다.

| 구분 | 책임과 연동 방향 |
| --- | --- |
| 독립 Studio·공통 제작 코어 | 코드·옵션·레이어·곡선 편집, seed/시간 평가, 미리보기·저장·출력. JavaScript·Worker·Node CLI 사용은 제작 도구의 선택이며 Rust 재작성의 전제 조건이 아니다. |
| 중립 출력 계약 | 편집 원본과 실행 산출물을 구분하고 atlas·프레임·시간·pivot·색/빛·이벤트 역할의 의미를 보존한다. |
| Ferrum2D 소비자 어댑터 | 출력물을 로드하고 기존 native 스프라이트 애니메이션·게임 이벤트·수명 관리에 연결한다. 제작용 소스를 게임에서 자동 실행하는 경로를 기본 연동으로 삼지 않는다. |
| Ferrum2D 실시간 입자 | 기존 방출기와 Rust 입자 계산을 사용한다. atlas 애니메이션과 실행 종류를 구분해 공용 리소스에서 참조한다. |

Studio의 곡선은 출력 프레임을 만드는 제작 기능이고, VX-05의 곡선은 게임에서 살아 있는 입자를 평가하는 기능이다.
atlas 재생은 기존 스프라이트 애니메이션 경로를 우선 사용하므로 VX-05 구현을 먼저 요구하지 않는다.

### 검토 사항과 반영 위치

| 검토 항목 | 개발 기준에 추가할 내용 | 반영 단계 |
| --- | --- | --- |
| 실제 실행 검증 순서 | 최소 출력 계약으로 한 효과를 실제 Wasm/GPU 게임에서 먼저 검증한다. 현재 편집 작업과 병행하며 시점·옵션 확장을 넓히기 전에 연동 근거를 확보한다. | VX-00 |
| pixelfx 실행 방식 | 순수 시간 함수형과 상태 누적 시뮬레이션형을 구분한다. 후자는 고정 step 재실행·유효한 snapshot·베이크 중 적용 방식을 정하고 임의 탐색의 지원 범위를 명시한다. | Studio 가져오기 계약, VX-00/01 |
| 코드·옵션·AI 왕복 편집 | 옵션/레이어의 안정적인 id와 바인딩, 편집 가능한 소스 범위를 정한다. 코드 수정 후 바인딩이 끊긴 옵션은 진단·복구 대상으로 표시하고 이전 값으로 소스를 덮어쓰지 않는다. | Studio 편집·저장 계약, VX-01 입출력 |
| atlas와 실시간 입자 구분 | 실행 종류와 지원 기능을 명시하고 서로 다른 산출물을 같은 프리셋 필드로 암묵 해석하지 않는다. | VX-01 |
| 정확한 color/light 합성 | 색 공간·알파 방식·빛 강도·그리기 순서·실패 시 상태 복구를 정의한다. 일반 alpha 호환 경로와 정확한 가산 합성의 통과 상태를 구분한다. | VX-00/01, 관련 renderer 지원 |
| 전체 자원 예산 | 프레임·atlas 한 장의 한도 외에 채널·페이지·방향 변형·동시 효과를 합산한다. 지원하지 않는 분할 출력은 미리 거절한다. | VX-00/01/02 |

pixelfx의 두 실행 방식은 [원본 구현 설명](https://github.com/patch-gg/pixelfx#how-it-works)을 따른다.
가져오기 대상의 upstream commit·효과 식별자·변경 이력·LICENSE/NOTICE를 기록하며,
별도 라이선스인 Patch Pixel 폰트는 재배포 자산에 포함하지 않는다.
전체 효과를 같은 편집 방식으로 지원한다고 가정하지 않고 지원·변환·미지원 목록을 관리한다.

코드·옵션 왕복의 완료 조건에는 옵션 수정 → 저장/재열기 → AI 또는 직접 코드 수정 → 바인딩 재검증 → 옵션 재편집을 포함한다.
식별자 삭제·이름 변경·지원 범위 밖 코드가 생겼을 때의 진단과 복구도 검사한다.
원본과 변경분을 보존하고, 임의 JavaScript 소스에서 옵션을 항상 자동 복원할 수 있다고 약속하지 않는다.

결정성 검사는 같은 소스·seed·시간·평가 버전의 코어 출력 기준으로 정의한다.
동일 시각으로 바로 탐색한 결과와 순차 재생·역방향 탐색·재열기 결과를 비교한다.
브라우저/GPU 출력의 색 공간·필터링·DPR 차이는 별도 시각 검증과 허용 오차로 관리한다.

## 개발 순서

각 단계는 독립적인 변경과 검증으로 진행한다. 단계 안의 하위 항목도 한 요청에 모두 구현하는 것을 전제하지 않는다.

| 순서 | 단계 | 우선순위·상태 | 완료 조건 |
| --- | --- | --- | --- |
| 0 | VX-00 최소 출력 계약·실게임 검증 | P1 · 미착수 | atlas 효과 한 개의 실제 엔진 재생·이벤트·소멸·자원 해제와 합성 지원 범위 기록 |
| 1 | VX-01 공용 효과 리소스·배포 | P1 · 미착수 | 기본 세 효과를 별도 게임 프로젝트에서 설치 패키지의 설정·에셋 참조만으로 재생 |
| 2 | VX-02 실행 인스턴스·부착·수명 | P1 · 미착수 | 동시 재생·개별 정지/정리·대상 삭제·씬 교체에서 다른 효과와 자원을 보존 |
| 3 | VX-03 게임 이벤트·복합 효과 연결 | P1 · 미착수 | 기존 native 이벤트로 피격/발걸음 효과를 실제 재생하고 중복·누락·재입력 방지 검증 |
| 4 | VX-04 방출 형태·방향 | P2 · 미착수 | 점·원·선·부채꼴 등 선택한 형태를 native에서 계산하고 seed·분포·하위 호환 검증 |
| 5 | VX-05 입자 표현 확장 | P2 · 미착수 | 회전·flipbook·변화 곡선을 각각 작은 변경으로 도입하고 실제 렌더 결과 검증 |
| 6 | VX-06 HD-2D 연결·표현 검증 | P2 · 미착수 | 높이·층·카메라·가림·좌표계를 명시하고 실제 공간에서 같은 리소스의 지원 범위 검증 |
| 7 | VX-07 효과 라이브러리·학습 확장 | P2 · 미착수 | 필요한 효과를 기존 리소스 형식으로 추가하고 용도·예산·사용 예제·에셋 출처 제공 |

**1차 제품화 범위는 VX-00 검증과 VX-01~03**이다. VX-04~07의 착수는 선행 단계의 결과와 실제 게임 요구로 정한다.
2D에서 먼저 검증하며 HD-2D 지원 여부를 리소스별로 명시한다. 미지원 공간 조합은 진단으로 알린다.

## VX-00 — 최소 출력 계약과 실제 엔진 검증

1. 원본 네 효과 중 한 개를 골라 고정 크기·일관된 pivot의 일반 alpha atlas와 최소 manifest를 만든다.
2. mock을 사용하지 않고 대상 Ferrum2D 패키지·Wasm·renderer에서 로드하고 one-shot을 재생한다.
3. 실제 게임의 발사/이동/명중 사건에 연결한다. 우선 명중 효과 한 개로 검증하고, 취소·빗나감에 impact가 생기지 않는지 확인한다.
4. 완료·재생 중 취소·씬 교체에서 마지막 프레임·시각 entity·자원이 남지 않는지 검사한다. 게임 투사체의 수명을 VFX가 결정하지 않는다.
5. color/light 분리 출력도 작은 격리 씬에서 확인하고 지원·근사·미지원 결과를 기록한다. 정확한 합성에 필요한 renderer 확장은 별도 변경으로 분리한다.

일반 alpha 경로 통과는 VX-01 진행 근거가 된다. 이를 정확한 additive 경로까지 통과한 것으로 표기하지 않는다.
현재 `setSpriteMaterial(...)`은 renderer의 재질 상태를 바꾸므로, 전체 게임을 additive로 바꾸는 구현은 완료 조건을 충족하지 않는다.
지원하는 public API를 통한 범위 제한과 정상/실패/취소 시 복구를 정하고 일반 sprite·UI·후처리에 영향이 없는지 검사한다.
밝고 어두운 배경, 방향·pivot, pause/resume, WebGL2/WebGPU의 실제 명령·픽셀을 근거로 남긴다.

이 단계는 최소 연동 검증이며 Studio의 전체 옵션 UI나 엔진의 범용 리소스 API를 먼저 완성하는 단계가 아니다.

## VX-01 — 공용 리소스와 패키지 제공

- 기존 `ParticleVfxPresetConfig`, `ParticlePresetConfig`, presentation registry를 확장·연결하는 최소 설계를 정한다.
- 리소스의 버전·이름·텍스처 참조·입자/방출 설정을 정의한다. 신규 이름과 필드는 구현 전에 확정한다.
- 기존 숫자 id·프리셋과 충돌하지 않는 등록 규칙, 중복 이름·누락 이미지·잘못된 범위의 진단을 정한다.
- 예제의 불꽃·먼지·잔상 설정과 자체 PNG를 공용 자산으로 옮긴다. 기존 SDK 프리셋 이름의 기본값 변경은 호환성 정책을 먼저 정한다.
- 기존 엔진 패키지의 선택 import·에셋 경로를 우선 검토한다. 새 npm 패키지나 production dependency를 기본 전제로 삼지 않는다.
- 엔진 import만으로 모든 VFX 이미지를 다운로드하지 않으며, 필요한 효과의 에셋을 명시적으로 로드한다.
- 이미지의 색 공간·알파·필터링과 에셋 참조의 해석을 정해 예제와 설치 프로젝트에서 같은 표현을 유지한다.
- 기능 실험실도 공용 리소스를 사용한다. 예제에 복사한 설정과 실제 패키지가 따로 발전하지 않게 한다.
- 실시간 입자와 atlas 애니메이션의 실행 종류를 구분하고 Studio 출력물을 공용 리소스로 가져오는 어댑터 경계를 정한다.

완료 근거는 source checkout이 아닌 로컬 tarball을 설치한 최소 게임에서 만든다.
텍스처 포함 여부·export 경로·중첩 URL·로딩 취소·해제와 기존 프리셋의 동작을 확인한다.

### Studio 출력 계약에서 확정할 내용

아래는 계약에 담을 의미이며 신규 필드명과 API는 구현 시 확정한다.

| 범주 | 확정할 내용과 검증 |
| --- | --- |
| 버전·출처 | schema/제작기 버전, 기본 효과와 upstream 버전, 소스·설정 fingerprint, seed, 변경분, 지원하는 엔진 버전 |
| 실행 종류 | 실시간 입자 또는 atlas 애니메이션, body/trail/impact 역할, 지원하는 시점·공간·합성 경로 |
| 이미지·좌표 | atlas 크기·페이지·frame rect·픽셀→UV 변환, 캔버스/원본 크기, pivot 단위와 원점, trim/회전 여부 |
| 시간 | 시간 단위, 프레임별 duration과 fps의 우선순위, one-shot/loop, 원본 source clock과 편집 구간의 대응 |
| 색·빛 | color/light/composite 구분, 색 공간·straight/premultiplied alpha·빛 강도 보존·합성 방식, 채널 간 frame/pivot 정렬 |
| 게임 사건 | 실제 shot/move/hit/cancel/expire 연결, entity generation·중복·순서 역전 처리, 본체 이후의 trail/impact 수명 |
| 예산 | 효과·프로젝트·실행 인스턴스별 해상도·프레임·페이지·채널·방향 수·메모리·동시 재생 한도와 초과 진단 |

첫 atlas 경로는 고정 크기·동일 pivot·무트림/무회전으로 시작한다.
프레임별 trim offset이나 크기 변화를 지원하려면 기존 native UV 애니메이션에 어떻게 대응할지 별도로 검증한다.
정상 재생은 기존 native 애니메이션 API를 우선 사용하며 JS에서 entity별 프레임 갱신을 추가하지 않는다.

원본 문서의 16MP atlas 한도는 채널별/페이지별/프로젝트 전체 중 적용 범위를 확정한다.
RGBA8 기준으로 각 16MP인 color/light 두 장은 약 128MB이며, 디코딩·업로드·페이지·방향 변형은 추가 비용이다.
512×512 프레임 256개는 약 67MP이므로 16MP 한 장으로 내보낼 수 없다. 분할 지원 또는 출력 전 거절 규칙을 정한다.
게임에서는 일반 alpha 호환 출력과 color/light 정확 합성에 필요한 자산을 선택해서 로드하고 공유 자산의 수명을 관리한다.

## VX-02 — 인스턴스·부착과 정리

- 같은 리소스를 여러 위치에서 재생하고 각 방출기를 독립적으로 정지한다. 기존 start·stop·reset을 재사용할 범위를 확정한다.
- 새 방출만 멈추는 정지, 남은 입자의 자연 만료, 소유 입자를 즉시 지우는 정리를 구분한다.
- 개별 정리가 필요한 경우 native 소유 식별자/handle 설계를 먼저 검토한다. 한 효과를 정리하면서 전역 `clearParticles()`로 다른 효과까지 지우지 않는다.
- 고정 월드 위치와 객체 부착, 방출 후 입자가 남는 좌표계를 명시한다. entity id와 generation을 함께 검증한다.
- 대상 삭제·씬 전환·pause/resume·늦게 끝난 에셋 요청·반복 재생 시 핸들·텍스처·타이머가 남지 않게 한다.
- 공유 이미지/소리의 수명은 기존 AssetLoader/assetHost 계약을 활용한다. 한 인스턴스의 종료로 다른 효과가 쓰는 공유 에셋을 해제하지 않는다.
- 기존 입자 수용량과 방출 상한을 활용한다. 최대 인스턴스·입자/프리셋 예산, 초과 시 거절/축소 정책과 관측 지표를 정한다.
- 동시 재생 중 한 인스턴스만 정리해 나머지 효과의 수명·입자·자원이 보존되는지 확인한다.

## VX-03 — 이벤트와 복합 효과

- 기존 `EffectEvent` bulk buffer와 presentation dispatch를 연결한다. TS에서 충돌·피격·발걸음 조건을 다시 계산하지 않는다.
- 피격은 기존 충돌/impact 경로, 발걸음은 기존 애니메이션 이벤트의 사용 가능 범위를 먼저 확인한다.
- 한 이벤트에 입자·소리 등 여러 리소스 참조를 연결한다. 기존 registry/action으로 해결되는 조합을 우선한다.
- 지연·조건·반복 횟수 같은 게임 판단은 기존 Rust gameplay/recipe 경계를 유지한다. 별도의 범용 스크립트·타임라인 실행기를 만들지 않는다.
- 같은 이벤트의 이중 dispatch, 삭제된 대상, 사운드 잠금·누락 자산, pause 중 재입력과 씬 변경을 검증한다.
- 예제는 충돌 시 불꽃과 발걸음 시 먼지를 실제 게임 이벤트로 재생한다. 수동 버튼과 별도로 이벤트 발생 근거를 표시한다.

## VX-04~07 — 후속 확장

| 단계 | 설계·구현 범위 | 필수 검증 |
| --- | --- | --- |
| VX-04 | 방출 형태·방향·퍼짐 범위·초기 위치 분포. Rust가 샘플링하며 기존 점 방출의 기본 동작 유지 | 고정 seed/step/방출 순서의 재현성, 범위 밖 입자·NaN 차단, 설정 없는 이전 데이터의 동일 동작 |
| VX-05 | 먼저 회전, 다음 flipbook, 다음 수명별 곡선 순으로 독립 검토. 기존 시작/종료 보간을 기본값으로 유지 | 실제 회전/UV 프레임/색·크기 결과, 경계 시각, 잘못된 keyframe 거절, 양 renderer 일치 |
| VX-06 | 기존 공간 입자·전투 경로를 확인하고 리소스 참조 연결. 높이·층·월드/화면 크기·부착·가림·카메라 의미 확정 | 경사/다층·높이 이동·객체 삭제·카메라 회전/확대와 지원하지 않는 조합의 진단 |
| VX-07 | 기본 세 효과 이후 착지 먼지·피격/총구 불꽃, 이후 필요한 연기·회복·마법 등을 개별 선택 | 효과별 구분 가능성·성능 예산·출처/라이선스·재생성, 공용 API를 사용하는 학습 화면 |

곡선의 입력 크기와 샘플 비용, flipbook 프레임 수/메모리, effect별 LOD·거리 제한은 실제 지원 단계에서 상한을 정한다.
고급 효과 목록 전체를 구현 완료 조건으로 묶지 않는다. 광원·Bloom·그림자 개선은
[조명 계획](lighting-quality-upgrade-plan.md)과 경계를 맞추고 중복 개발하지 않는다.

## 아키텍처와 호환성 기준

- Rust는 입자 상태·난수·적분·수명·보간·렌더 명령을 소유한다. TS는 로딩·브라우저 출력·표현 설정과 기존 방출기 실행을 담당한다.
- 객체를 따라가는 효과는 기존 native 경로 또는 generation을 포함한 bulk pose 읽기를 활용한다. 입자/객체별 매 프레임 JS/Wasm 왕복은 추가하지 않는다.
- borrowed Wasm view는 같은 소비 구간에서만 읽는다. 이후 쓸 자료는 숫자로 복사한다.
- 새로운 공유 필드/ABI가 필요하면 `repr(C)`·stride/offset·크기 검사·버전·이전 데이터 호환을 함께 검토한다.
- 기존 숫자 preset API·기본 이름·게임 이벤트·physics feedback을 보존한다. 동일 책임의 별도 registry나 이벤트 루프를 만들지 않는다.
- 데이터는 적용 전에 검증한다. 잘못된 리소스가 다른 실행 중 효과·씬 상태를 먼저 지우지 않아야 한다.
- public API/스키마 변경 시 엔진 문서·architecture·타입/패키지 surface·consumer 검증을 함께 갱신한다.

## 검증 계획

아래는 현재 존재하는 명령이다. 미래 테스트를 이미 있는 것으로 표기하지 않는다.
신규 리소스/인스턴스 회귀는 해당 단계 구현 때 추가하고 기존 CI의 적절한 실행 경로에 연결한다.

| 변경 범위 | 적용할 검증 |
| --- | --- |
| TS·공용 계약 | `pnpm lint`, `pnpm test:web`, `pnpm validate:public-api-surface` |
| Rust·Wasm 변경 | `cargo fmt`, `cargo clippy`, `cargo test --manifest-path crates/ferrum-core/Cargo.toml`, `pnpm build` |
| 기존 방출기 회귀 | `pnpm smoke:particle-vfx` |
| 학습 예제 | `pnpm smoke:feature-examples`; 빌드 후 주제만 검사할 때 `node tests/smoke/feature-examples-smoke.mjs --particles-only` |
| 에셋·export·설치 | `pnpm package:check:ferrum-web`와 별도 게임 프로젝트의 실제 tarball import/에셋 재생 검증 |
| 공간 지원 변경 | `pnpm smoke:spatial-scene`, `pnpm smoke:spatial-webgpu-offscreen`; 관련 전투 경로 변경 시 `pnpm smoke:hd2d-combat` |
| 문서·로컬 Pages | `pnpm validate:docs-links`, `pnpm build:pages`, `pnpm validate:pages-artifact` |

기존 `--particles-only` 검사는 native 입자 예제의 회귀 기준이며 Studio atlas 어댑터의 통과 근거로 사용하지 않는다.
Studio 소스 ZIP을 확보하면 실제 CLI 테스트·렌더·출력 명령과 결과를 기록하고,
실제 게임에서 atlas를 소비하는 별도 browser smoke를 구현 단계에서 추가해 CI 실행 경로에 연결한다.

native Playing/Paused 상태와 실제 명령·픽셀을 검증한다. 설정값이나 입자 개수만으로 완료 판정하지 않는다.
동시 효과의 격리·자원 0 복귀·부분 초기화 취소·용량 제한·WebGL2/WebGPU와 390/320px 화면을 포함한다.
소프트웨어 GPU 결과와 실물 GPU/기기 검증을 구분하고, 성능 상한은 실행 환경과 함께 기록한다.

## 1차 제품화 완료 기준

- [ ] Studio 출력 효과 한 개가 mock 없이 실제 Wasm/GPU 게임에서 로드·명중 재생·소멸·정리를 통과한다.
- [ ] atlas와 실시간 입자의 계약, alpha 호환과 정확 additive의 지원 상태를 구분해 기록한다.
- [ ] 설치한 엔진 패키지만으로 자체 세 효과의 설정·이미지를 불러와 재생한다.
- [ ] 기능 실험실과 최소 게임이 같은 공용 효과 리소스를 사용한다.
- [ ] 두 인스턴스를 동시에 실행하고 하나만 정지/정리해도 다른 효과가 유지된다.
- [ ] 실제 충돌·애니메이션 이벤트로 효과를 재생하며 pause·대상 삭제·씬 전환을 처리한다.
- [ ] 기존 프리셋/API 호환·네이티브 계산·양 renderer·자원·패키지 검증을 통과한다.
- [ ] 사용자 문서와 지원 범위·실행 근거가 동기화되어 있다.

VX-04~07의 목표는 위 1차 완료와 구분한다. 각 단계가 끝나면 현재 사용법과 검증은 공식 문서로 옮기고,
이 문서는 남은 범위만 유지한다. 전체 계획이 끝나면 문서와 색인 참조를 삭제한다.

## 이번 계획에서 구현하지 않는 범위

Niagara/VFX Graph 같은 노드 제작 화면, 범용 visual editor·FSM/action graph 편집기,
GPU 입자 시뮬레이션 전환, full Worker/Wasm threads, 유체·복잡한 입자 물리, 스켈레탈 애니메이션은
별도 설계 범위다. 이번 문서는 해당 기능의 구현 착수나 외부 배포를 승인하는 문서가 아니다.
독립 Studio의 제작용 타임라인·옵션 편집과 Worker 사용은 독립 도구의 범위다.
이를 Ferrum2D 내부의 범용 visual editor 도입이나 게임 루프 Worker 이전으로 확대하지 않는다.
