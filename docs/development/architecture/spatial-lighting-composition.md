# Spatial 조명 성분과 화면 효과 합성

현재 개발 소스의 합성 계약이다. 설치한 배포 버전의 지원 여부는 해당 버전의 공개 타입을 확인한다.

기존 `composition` 생략 경로는 기존 픽셀·자원 비용을 보존한다. 선택형 `composition:"separated"`는
AO를 환경광·hemisphere 성분에만 적용하고 직접광·발광·unlit 색을 보존한다.
명시적 `"legacy"` 선택도 저장한다. 선택 필드는 native environment v6/544-float의 528번 값이며
529..543은 0이어야 한다. v1..v5의 길이와 의미는 유지하며 혼합 version/length를 거절한다.
WebGPU 내부 camera uniform의 `forward.w`는 명시적인 pass bitfield(AO resolve=1, separated=2, DOF 선행=4)다.
현재 mask·wide·두 번째 점광원·태양/점광원 PCSS·높이 안개 확장을 포함한 record는2,704 bytes다. native 환경 prefix와 고정 sun center를 덮어쓰지 않는다.

## 성분 분리 경로의 연산 순서

1. geometry는 기존 HDR 색과 별도 선형 환경광 기여를 같은 depth 테스트의 MRT에 기록한다.
   `total = indirect + direct + emission`이며 unlit/debug 표면의 indirect는 0이다.
2. depth AO를 계산해 `total - indirect × (1 - visibility)`로 환경광만 줄인 뒤 fog를 적용한다.
3. depth-aware DOF를 적용한다. foreground/background 경계는 기존 표준/고품질 kernel의 depth gate를 따른다.
4. Bloom은 AO·fog·DOF 뒤의 선형 HDR 색을 읽는다. threshold는 exposure 전의 선형 값이다.
5. exposure·tone mapping·색 보정·출력 변환을 한 번 적용한 뒤 기존 flat HUD를 그린다.

각 추가 target/pass는 해당 효과 조합이 실제로 필요할 때만 만든다. profile 생략, 효과 strength 0,
빈 환경과 비활성 조합에서 불필요한 추가 MRT/resolve/DOF target을 유지하지 않는다.
Spatial 내부 HDR은 renderer 전역 linear-sRGB와 별개이며, 전역 WebGPU 색공간은 별도 managed target·최종 표시 경로를 사용한다. 환경 합성은 그 선형 target에 출력한다.

## 판정할 근거

- emission-only·direct-only 표면은 AO OFF/ON 간 RGB 오차 3 byte 이내이며, ambient-only 접촉면은 실제로 어두워져야 한다.
- fog가 적용된 결과를 AO로 다시 어둡게 하지 않는다. 동일 total HDR에서 새 경로와 단계별 reference를 비교한다.
- Bloom body/halo, DOF foreground·HUD 경계를 분리해 검사한다. 전체 이미지 차이만으로 통과시키지 않는다.
- WebGL2와 실제 WebGPU, projection·DPR·resize·OFF 복귀·저장/복원·device recovery를 검사한다.
- pass/target/bytes·실제 sample 설정을 통계와 보고서에 연결하고 warm 자원 plateau와 실패 정리를 확인한다.
- 소프트웨어 GPU 결과를 실물 GPU 성능 보장으로 해석하지 않는다. 실게임·실기기 검증은 개발 완료 후 진행한다.


## 넓은 Bloom의 별도 저해상도 chain

`spatialBloom`은 opt-in source/cold capability만, `spatialBloomKernel`은 GPU work 계획/셰이더만 소유한다.
Rust는 v9/584 source·selection 존재/서명·저장 원자성을 소유한다. 렌더/시뮬레이션 ABI 예약 필드는 재사용하지 않는다.
GL/GPU는 box bright extraction → 필요한2배 downsample → coarse 가로/세로 blur → 기존 HDR composite의
4-load 보간 순서를 공유한다. 광원 선택이나 frame 시간 이력은 JS에서 계산하지 않는다.

coarse 위치는 `uv × sourceExtent / cumulativeScale - 0.5`다. ceil extent를 normalized UV 전체에 늘려 쓰지 않는다.
GL의 stage destination·source fetch를 top-left 논리 좌표로 계산한 뒤 texelFetch에서 물리 Y를 바꾼다.
WebGPU/CPU 참조는 원래 top-left다. 홀수 target에서도 source texel phase를 유지한다.
pixelArt의 마지막 wide 샘플은 scene pixel 중심에 고정한다. 기존 gather 수식은 보존한다.

private GPU 환경은512-float prefix·camera/matrix/channel tail 뒤의648~651 words에 wide enable/grid vec4를 둔다.
그 뒤 두 번째 점광원652~655, 태양 PCSS656~659, 두 점광원 PCSS660~667, 높이 안개/카메라668~675를 포함해 현재2,704 bytes다.
dynamic stride2,816의 두 슬롯(총5,632 bytes)을 사용하며 native584-float wide Bloom source와 같은 배열이 아니다.
별도 WebGPU stage uniform은16×256-byte, 각 stage는32-byte config/threshold를 참조한다.
서로 다른 stage의 queue write가 앞선 stage의 설정을 덮지 않는다. helper는 한 composite/encoder에서 사용하며,
renderer는 각 command packet을 제출한 뒤 다음 packet의 uniform을 쓴다.

각 level의 HDR texture와 coarse blur scratch는 한 번에 준비해 성공 후 교체한다. warm frame은
texture/buffer/group/pipeline을 새로 만들지 않는다. OFF/extent 변경/destroy가 target을 회수한다.
WebGPU 동기 오류는 캐시 publication 전 거절하고 비동기 allocation/binding 실패는 무효 target을 해제해
다음 API 호출에 드러낸다. 이 terminal GPU 실패는 device recovery에서 새 backend/helper로 복구한다.

추가 draw는 실제 chain/blur pass 수, target bytes는 RGBA16F8 bytes/texel의 level 합+coarse scratch다.
load budget은 bright box + 이후2×2 box + 두 Gaussian(tap당2-load 보간) + 최종 viewport4-load의 합이다.
viewport는 pixelArt 내부 extent와 구분해 최종 출력 영역을 사용한다. scissor/coverage/driver 최적화가 실행량을
줄일 수 있으므로 work 상한이며 GPU 시간 측정값이 아니다. 프레임 합계는 HUD 뒤에도 유지하고 target bytes는 peak로 남긴다.
