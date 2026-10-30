# Blender 텍스처 변환 회귀 자산

Ferrum2D에서 직접 생성한 작은 quad와 8×8 PNG 세 개다. 외부 모델/텍스처는 포함하지 않는다.
`mapping.glb`와 `mapping.gltf`/`mapping.bin`/PNG는 같은 Blender 장면의 수정하지 않은 exporter 출력이다.

- 생성 도구: Blender 5.2.2 LTS (`d13f752e3b9c`), glTF exporter v5.2.40.
- 재생성: 저장소 루트에서 `blender --background --factory-startup --python scripts/assets/build-texture-transform-fixture.py`.
- geometry: quad 4 vertices/2 triangles, glTF Y-up, UV0, exported tangent, double-sided MASK.
- 세 개의 UV → Mapping(Point) → Image Texture 노드: base의 90도 회전/배율/이동,
  normal의 음수 X 배율/회전/이동, emissive의 독립 회전/배율/이동.
- export가 Blender와 glTF의 UV 기준 차이를 반영하므로 JSON offset은 Mapping UI의 입력과 다르다.
  generator 입력과 exporter 출력을 별도로 보존하며 JSON 숫자를 기대값에 맞춰 수정하지 않는다.
- exporter는 base color/alpha 연결에서 여러 image-node 사용 경고를 출력한다. 둘 다 동일 image와 Mapping,
  nearest/repeat 설정을 참조한다. 결과의 alphaMode MASK와 sampler는 단위/브라우저 회귀에서 확인한다.

`spatialTextureTransform.test.ts`는 loader/값 검증/batching을, packed spatial browser smoke는 WebGL2/WebGPU
색·normal·발광·MASK 그림자·CPU picking과 분리형 glTF를 검사한다. 브라우저 reference는 동일 파일의 UV0를
원본 Blender Mapping 값으로 bake한 뒤 glTF UV로 바꾼 파생본이다. extension JSON 숫자나 셰이더/loader의
행렬 함수를 reference 작성에 재사용하지 않는다. 양 backend에서 동시에 발생한 부호 오류도 검출한다.
회전은 top-left UV의 +V가 아래인 방향을 기준으로 한다. 규격 GLSL 예제와의 부호 차이는
[Khronos #1563](https://github.com/KhronosGroup/glTF/issues/1563)에 설명되어 있으며 Blender/three.js 방향을 따른다.

게임 예제나 범용 Blender material 지원 샘플이 아니다. UV1+, procedural nodes, skin/morph/animation,
Draco/Meshopt geometry 압축, PBR/BLEND는 이 fixture의 범위 밖이다.
