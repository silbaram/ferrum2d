# WebGL2 Renderer 구현 패턴

스프라이트 배치 렌더러를 WebGL2로 짤 때의 구체 패턴들. SKILL.md §4의 결정 기준을 코드 레벨로 풀어둔다.

## 목차

1. Context 생성 / 손실 처리
2. Shader compile / link / introspection
3. VAO + dynamic vertex buffer
4. Sprite batch 구현
5. Texture 생성 / atlas / 필터 선택
6. Camera2D — 투영 행렬
7. Blend state / depth / scissor
8. Render stats — draw calls / batches / vertices
9. Resource teardown

---

## 1. Context 생성 / 손실 처리

### 1.1 옵션

```ts
const gl = canvas.getContext("webgl2", {
  alpha: false,                  // canvas 뒤가 투명할 필요 없으면 false (성능 ↑)
  antialias: true,               // MSAA — false로 끄고 셰이더에서 처리할 수도
  premultipliedAlpha: true,      // 합성 모드와 일관성 — true 권장
  preserveDrawingBuffer: false,  // false가 빠름. screenshot 필요 시만 true
  powerPreference: "high-performance",
  failIfMajorPerformanceCaveat: false,  // SwiftShader fallback 허용
}) as WebGL2RenderingContext | null;

if (!gl) throw new Error("WebGL2 not supported");
```

### 1.2 Context 손실 / 복원

탭 백그라운드 / GPU 리셋 / 드라이버 크래시 시 발생. 기본 동작은 자원이 모두 무효화 — 미리 복원 핸들러 등록:

```ts
canvas.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  this.handleContextLost();
});
canvas.addEventListener("webglcontextrestored", () => {
  this.recreateAllResources();
});
```

MVP는 단순히 게임을 일시정지 + 사용자에게 복구 안내로 충분. v1.0급 안정성이 필요하면 모든 텍스처 / 셰이더 / 버퍼를 다시 만드는 복원 경로 구현. 자원을 만든 시점의 정보 (URL, source code)를 멤버로 보관해야 재생성 가능.

---

## 2. Shader compile / link / introspection

### 2.1 컴파일 헬퍼

```ts
function compileShader(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("createShader returned null");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed:\n${log}\n--- source ---\n${source}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const prog = gl.createProgram();
  if (!prog) throw new Error("createProgram returned null");
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`Link failed:\n${log}`);
  }
  // shader는 link 후 detach + delete 가능 (program이 보유)
  gl.detachShader(prog, vs); gl.deleteShader(vs);
  gl.detachShader(prog, fs); gl.deleteShader(fs);
  return prog;
}
```

에러 메시지에 **source 포함** — 어떤 shader가 깨졌는지 즉시 식별. 매크로 / template으로 생성된 셰이더는 line 번호가 다르니 source 동봉이 필수.

### 2.2 Sprite shader (MVP)

```glsl
// vertex.glsl
#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in vec4 a_color;

uniform mat3 u_viewProjection;

out vec2 v_uv;
out vec4 v_color;

void main() {
  vec3 pos = u_viewProjection * vec3(a_position, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
  v_uv = a_uv;
  v_color = a_color;
}
```

```glsl
// fragment.glsl
#version 300 es
precision mediump float;

uniform sampler2D u_texture;

in vec2 v_uv;
in vec4 v_color;

out vec4 outColor;

void main() {
  vec4 tex = texture(u_texture, v_uv);
  outColor = tex * v_color;
  if (outColor.a < 0.001) discard;  // alpha test — 깊이 정렬 필요 시
}
```

핵심:
- `#version 300 es` 첫 줄 (앞에 공백/주석 X — 문법 에러 발생).
- `precision highp/mediump` 명시 — vertex는 `highp`, fragment는 `mediump`이 일반적.
- `layout(location = N)` — VAO setup이 단순. JS에서 `getAttribLocation` 호출 안 해도 됨.
- `discard`는 alpha=0 픽셀에서만. 모든 pass에서 박으면 early-z 깨짐 (성능 저하).

### 2.3 Uniform location 캐싱

```ts
class SpriteShader {
  readonly program: WebGLProgram;
  readonly u_viewProjection: WebGLUniformLocation;
  readonly u_texture: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = linkProgram(gl, /* ... */);
    this.u_viewProjection = gl.getUniformLocation(this.program, "u_viewProjection")!;
    this.u_texture = gl.getUniformLocation(this.program, "u_texture")!;
  }
}
```

`getUniformLocation`은 매 프레임 호출하지 마. init에 한 번 + 멤버로.

---

## 3. VAO + dynamic vertex buffer

### 3.1 Vertex 레이아웃

스프라이트 1개 = quad = 4 vertex + 6 index.

```
Vertex (5 floats = 20 bytes):
  [0] position.x  (f32)
  [1] position.y  (f32)
  [2] uv.x        (f32)
  [3] uv.y        (f32)
  [4] color       (u32 packed RGBA, but stored in f32 slot via DataView)
```

color를 f32 slot에 packed u32로 넣으면 vertex stride가 균일해짐. fragment shader에서는 `unpackUnorm4x8()` 호출 또는 vertex attribute를 `unsigned byte normalized`로 세팅.

### 3.2 VAO setup (init에 한 번)

```ts
const vao = gl.createVertexArray()!;
gl.bindVertexArray(vao);

const vbo = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, MAX_BATCH_VERTICES * VERTEX_SIZE, gl.DYNAMIC_DRAW);

const STRIDE = 20;  // 5 floats
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, STRIDE, 0);   // position
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 2, gl.FLOAT, false, STRIDE, 8);   // uv
gl.enableVertexAttribArray(2);
gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, STRIDE, 16);  // color (normalized)

const ibo = gl.createBuffer()!;
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.buildQuadIndices(MAX_QUADS), gl.STATIC_DRAW);

gl.bindVertexArray(null);
```

`MAX_BATCH_VERTICES = 4 * MAX_QUADS_PER_BATCH`. 보통 `MAX_QUADS = 4096` (16384 vertex, 64KB CPU staging) 정도.

Index buffer는 정적: `[0,1,2, 0,2,3, 4,5,6, 4,6,7, ...]` — 모든 batch에서 재사용 가능.

```ts
private buildQuadIndices(maxQuads: number): Uint16Array {
  const indices = new Uint16Array(maxQuads * 6);
  for (let q = 0; q < maxQuads; q++) {
    const i = q * 6;
    const v = q * 4;
    indices[i + 0] = v + 0; indices[i + 1] = v + 1; indices[i + 2] = v + 2;
    indices[i + 3] = v + 0; indices[i + 4] = v + 2; indices[i + 5] = v + 3;
  }
  return indices;
}
```

`Uint16Array`로 충분 (4096 quads × 4 = 16384 < 65536). 더 큰 batch는 `Uint32Array` + `OES_element_index_uint` (WebGL2는 default 지원).

### 3.3 Dynamic upload — `bufferSubData`

```ts
private vertexStaging = new Float32Array(MAX_BATCH_VERTICES * 5);
private colorStagingU32 = new Uint32Array(this.vertexStaging.buffer);

private flushBatch(quadCount: number, textureId: number): void {
  if (quadCount === 0) return;

  // 위 vertexStaging은 이미 채워진 상태
  gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
  gl.bufferSubData(
    gl.ARRAY_BUFFER, 0,
    this.vertexStaging,
    0,
    quadCount * 4 * 5,  // 5 floats per vertex × 4 vertices per quad
  );

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, this.textureManager.get(textureId));

  gl.drawElements(gl.TRIANGLES, quadCount * 6, gl.UNSIGNED_SHORT, 0);
  this.stats.drawCalls++;
  this.stats.batches++;
  this.stats.vertices += quadCount * 4;
}
```

**`bufferData` 매번 호출 금지** — 매번 GPU buffer 재할당, drive sync stall 가능. `bufferSubData`는 in-place 갱신.

추가 최적화 — `bufferSubData` 호출 전 `bufferData(... null, DYNAMIC_DRAW)`로 "buffer orphaning"을 명시할 수도 (드라이버 hint). MVP에서는 무시.

---

## 4. Sprite batch 구현

### 4.1 batch 분기 조건

같은 batch에 들어갈 수 있는 조건:
1. 같은 texture (texture_id 동일).
2. 같은 shader (MVP는 sprite shader 하나).
3. quad 수가 MAX_QUADS_PER_BATCH 미만.

조건 위반하면 flush + 새 batch.

### 4.2 Vertex 생성 — TRS

각 sprite를 4 vertex로 확장:

```ts
private writeQuad(
  cmdF32: Float32Array, cmdU32: Uint32Array, cmdBase: number,
  vertOffset: number,
): void {
  // command fields
  const x = cmdF32[cmdBase + 1];
  const y = cmdF32[cmdBase + 2];
  const rotation = cmdF32[cmdBase + 3];
  const scaleX = cmdF32[cmdBase + 4];
  const scaleY = cmdF32[cmdBase + 5];
  const srcX = cmdF32[cmdBase + 6];
  const srcY = cmdF32[cmdBase + 7];
  const srcW = cmdF32[cmdBase + 8];
  const srcH = cmdF32[cmdBase + 9];
  const color = cmdU32[cmdBase + 10];

  // local quad corners (-0.5 ~ 0.5)
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const hw = srcW * 0.5 * scaleX;
  const hh = srcH * 0.5 * scaleY;

  const v = this.vertexStaging;
  const cu = this.colorStagingU32;

  // 4 corners: TL, TR, BR, BL
  const corners = [
    [-hw, -hh, srcX, srcY],
    [ hw, -hh, srcX + srcW, srcY],
    [ hw,  hh, srcX + srcW, srcY + srcH],
    [-hw,  hh, srcX, srcY + srcH],
  ];

  let off = vertOffset;
  for (const [lx, ly, u, uy] of corners) {
    const wx = x + lx * cos - ly * sin;
    const wy = y + lx * sin + ly * cos;
    v[off + 0] = wx;
    v[off + 1] = wy;
    v[off + 2] = u / this.textureManager.widthOf(textureId);   // normalized UV
    v[off + 3] = uy / this.textureManager.heightOf(textureId);
    cu[off + 4] = color;  // u32로 같은 슬롯에 packed 색상
    off += 5;
  }
}
```

핫루프이므로 함수 호출 / object 생성 최소화. 위 `corners` 배열은 가독성용 — 실측정에서 핫하면 inline.

### 4.3 UV 정규화 — 텍스처 크기 의존

Rust 측 `src_x/y/w/h`는 픽셀 좌표 (atlas 친화). UV는 `[0, 1]` 정규화. 텍스처마다 크기가 다르므로 `TextureManager.widthOf(id)`로 query.

대안: Rust 측이 미리 UV를 정규화. atlas 크기를 Rust가 알아야 하므로 자산 로드 시 Rust로 size 전달 필요. MVP는 TS 측 정규화가 단순.

---

## 5. Texture 생성 / atlas / 필터 선택

### 5.1 ImageBitmap → WebGLTexture

```ts
async loadTexture(name: string, url: string): Promise<TextureId> {
  const blob = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Failed to load ${url}: ${r.status}`);
    return r.blob();
  });
  const bitmap = await createImageBitmap(blob, {
    imageOrientation: "from-image",
    premultiplyAlpha: "premultiply",  // shader 합성과 일관성
  });

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);  // canvas Y축과 image Y축 통일
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA,
    gl.RGBA, gl.UNSIGNED_BYTE,
    bitmap,
  );

  // 필터 — 픽셀 아트는 NEAREST, 일반은 LINEAR
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  bitmap.close();

  const id = this.nextId++;
  this.textures.set(id, { gl: tex, width: bitmap.width, height: bitmap.height });
  this.nameToId.set(name, id);
  return id as TextureId;
}
```

### 5.2 픽셀 아트

```ts
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
```

LINEAR로 두면 픽셀 아트가 흐릿. NEAREST가 정답. 자산별로 다를 수 있으므로 manifest 또는 sprite 메타에 hint.

### 5.3 Mipmap

```ts
gl.generateMipmap(gl.TEXTURE_2D);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
```

축소 표시되는 텍스처 (월드맵, 줌아웃 가능 카메라)에 유용. 픽셀 아트 / 항상 1:1 표시되는 UI는 mipmap 불필요 — 메모리 33% 절약.

### 5.4 Texture atlas

여러 sprite를 한 큰 텍스처에 packing → batch 효율 ↑ (`texture_id` 변경 줄어듦).

MVP는 atlas 도구 없이 진행 가능 — sprite마다 별도 텍스처. 성능 측정 후 atlas 도입. 흔한 도구: TexturePacker, free-tex-packer.

Rust 측은 atlas 안 sprite를 `(texture_id, src_x, src_y, src_w, src_h)`로 표현 — 위 SpriteRenderCommand 레이아웃과 자연스럽게 호환.

---

## 6. Camera2D — 투영 행렬

### 6.1 view-projection 행렬

3×3 행렬 (2D affine):

```ts
class Camera2D {
  x = 0;
  y = 0;
  zoom = 1;
  rotation = 0;
  viewportWidth = 1280;   // CSS 픽셀
  viewportHeight = 720;

  viewProjection(): Float32Array {
    // World → NDC
    // 1. world에서 camera로: translate(-x, -y), rotate(-rotation), scale(zoom)
    // 2. camera에서 NDC로: scale(2/w, 2/h)
    const c = Math.cos(-this.rotation);
    const s = Math.sin(-this.rotation);
    const sx = (2 * this.zoom) / this.viewportWidth;
    const sy = (2 * this.zoom) / this.viewportHeight;

    // column-major (GLSL mat3)
    return new Float32Array([
       c * sx,  s * sy, 0,
      -s * sx,  c * sy, 0,
      (-this.x * c + this.y * s) * sx,
      (-this.x * s - this.y * c) * sy,
      1,
    ]);
  }
}
```

매 프레임 동일 메모리 영역 재사용:

```ts
private vpMatrix = new Float32Array(9);

updateViewProjection(camera: Camera2D): void {
  // Float32Array를 매번 new 하지 말고 in-place 채움
  const m = this.vpMatrix;
  // ... 위 계산 결과를 m[0..8]에 직접 set
}
```

shader에 업로드:

```ts
gl.uniformMatrix3fv(shader.u_viewProjection, false, this.vpMatrix);
```

### 6.2 Y축 방향

WebGL NDC는 Y가 위. canvas 픽셀은 Y가 아래. 게임 좌표계 결정:
- Y 위 (수학적 자연스러움) — 위 행렬 그대로.
- Y 아래 (canvas/스크린 자연스러움) — `sy`를 `-sy`로.

엔진 전체에 일관되게 한 방향. 이 결정이 흔들리면 모든 입력/렌더 코드에 미친 버그.

---

## 7. Blend state / depth / scissor

### 7.1 Alpha blend

```ts
gl.enable(gl.BLEND);
gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);  // premultiplied alpha
// 또는 gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);  // straight alpha
```

`createImageBitmap`의 `premultiplyAlpha: "premultiply"`와 `gl.ONE, ONE_MINUS_SRC_ALPHA`가 일관된 한 쌍. 잘못 짝지으면 알파 가장자리에 검은 테두리.

### 7.2 Depth — 2D는 끄기

```ts
gl.disable(gl.DEPTH_TEST);
```

레이어 정렬이 painter's algorithm (뒤에서부터 그리기)으로 처리되므로 depth buffer 불필요. 끄면 메모리 + GPU 시간 절약.

### 7.3 Clear

```ts
gl.clearColor(0, 0, 0, 1);
gl.clear(gl.COLOR_BUFFER_BIT);
```

depth 안 쓰면 `DEPTH_BUFFER_BIT` 빼기.

### 7.4 Scissor — 영역 제한

UI 등 부분 영역만 그리려면:

```ts
gl.enable(gl.SCISSOR_TEST);
gl.scissor(x, y, w, h);
// 그리기
gl.disable(gl.SCISSOR_TEST);
```

scissor 좌표는 백버퍼 픽셀 (Y 아래). HUD 잘라내기, minimap 등에 사용.

---

## 8. Render stats — draw calls / batches / vertices

```ts
export interface RenderStats {
  drawCalls: number;
  batches: number;
  vertices: number;
  textures: number;     // 이번 프레임 사용된 unique texture
  frameTimeMs: number;
}

class WebGL2Renderer {
  readonly stats: RenderStats = { drawCalls: 0, batches: 0, vertices: 0, textures: 0, frameTimeMs: 0 };
  private frameStart = 0;

  render(commands: Float32Array, count: number, camera: Camera2D): void {
    this.frameStart = performance.now();
    this.stats.drawCalls = 0;
    this.stats.batches = 0;
    this.stats.vertices = 0;
    // ...
    this.stats.frameTimeMs = performance.now() - this.frameStart;
  }
}
```

DebugOverlay가 매 프레임 stats를 읽어 표시. CI에서도 export — 회귀 테스트에 사용 가능.

```ts
// 1000 sprites + 1 atlas → 기대 stats
expect(stats.drawCalls).toBe(1);
expect(stats.batches).toBe(1);
expect(stats.vertices).toBe(4000);
```

---

## 9. Resource teardown

게임 종료 / 엔진 destroy 시:

```ts
destroy(): void {
  for (const tex of this.textures.values()) gl.deleteTexture(tex.gl);
  this.textures.clear();
  gl.deleteBuffer(this.vbo);
  gl.deleteBuffer(this.ibo);
  gl.deleteVertexArray(this.vao);
  gl.deleteProgram(this.shader.program);
  // gl context 자체는 canvas 제거 시 GC
}
```

WebGL 자원은 GC 대상이 아니다 (driver memory). 명시적 `delete*` 호출 안 하면 페이지 새로고침까지 누수.

브라우저는 보통 페이지 navigation 시 정리하지만, SPA에서 게임을 mount/unmount 반복하면 누적. SPA 친화 게임엔진은 destroy를 정확히 구현해야.

---

## 참고

- [WebGL2 Fundamentals](https://webgl2fundamentals.org/) — WebGL2 학습 표준 자료.
- [WebGL Best Practices (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices) — context loss / 자원 관리.
- [Khronos WebGL2 Reference Card](https://www.khronos.org/files/webgl20-reference-guide.pdf) — API 한눈 보기.
- [WebGL Insights](http://www.webglinsights.com/) — 고급 패턴.