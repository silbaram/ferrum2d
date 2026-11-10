# Spatial 조명 성분과 화면 효과 합성

상태: M3a 개발 소스 구현·자동 회귀 검증 완료. 설치한 배포 버전의 지원 여부는 해당 버전의 공개 타입을 확인한다.

기존 `composition` 생략 경로는 기존 픽셀·자원 비용을 보존한다. 새 `composition:"separated"`는
AO를 환경광·hemisphere 성분에만 적용하고 직접광·발광·unlit 색을 보존한다.
명시적 `"legacy"` 선택도 저장한다. 선택 필드는 native environment v6/544-float의 528번 값이며
529..543은 0이어야 한다. v1..v5의 길이와 의미는 유지하며 혼합 version/length를 거절한다.
WebGPU 내부 camera uniform v2는 기존 2,560-byte 크기를 유지하고 `forward.w`를 명시적인
pass bitfield(AO resolve=1, separated=2, DOF 선행=4)로 정의한다. native 환경 prefix와 고정 sun center를 덮어쓰지 않는다.

## 새 경로의 연산 순서

1. geometry는 기존 HDR 색과 별도 선형 환경광 기여를 같은 depth 테스트의 MRT에 기록한다.
   `total = indirect + direct + emission`이며 unlit/debug 표면의 indirect는 0이다.
2. depth AO를 계산해 `total - indirect × (1 - visibility)`로 환경광만 줄인 뒤 fog를 적용한다.
3. depth-aware DOF를 적용한다. foreground/background 경계는 기존 표준/고품질 kernel의 depth gate를 따른다.
4. Bloom은 AO·fog·DOF 뒤의 선형 HDR 색을 읽는다. threshold는 exposure 전의 선형 값이다.
5. exposure·tone mapping·색 보정·출력 변환을 한 번 적용한 뒤 기존 flat HUD를 그린다.

각 추가 target/pass는 해당 효과 조합이 실제로 필요할 때만 만든다. profile 생략, 효과 strength 0,
빈 환경과 비활성 조합에서 불필요한 추가 MRT/resolve/DOF target을 유지하지 않는다.
Spatial 내부 HDR은 renderer 전역 linear-sRGB와 별개이며, 전역 WebGPU 색공간은 M3c에서 검증한다.

## 판정할 근거

- emission-only·direct-only 표면은 AO OFF/ON 간 RGB 오차 3 byte 이내이며, ambient-only 접촉면은 실제로 어두워져야 한다.
- fog가 적용된 결과를 AO로 다시 어둡게 하지 않는다. 동일 total HDR에서 새 경로와 단계별 reference를 비교한다.
- Bloom body/halo, DOF foreground·HUD 경계를 분리해 검사한다. 전체 이미지 차이만으로 통과시키지 않는다.
- WebGL2와 실제 WebGPU, projection·DPR·resize·OFF 복귀·저장/복원·device recovery를 검사한다.
- pass/target/bytes·실제 sample 설정을 통계와 보고서에 연결하고 warm 자원 plateau와 실패 정리를 확인한다.
- 소프트웨어 GPU 결과를 실물 GPU 성능 보장으로 해석하지 않는다. 실게임·실기기 검증은 개발 완료 후 진행한다.
