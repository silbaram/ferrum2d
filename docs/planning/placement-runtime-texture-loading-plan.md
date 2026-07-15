# Placement Viewer Runtime Texture Loading 설계

이 문서는 `apps/placement-viewer-desktop`가 local project asset folder의 이미지를 실제 placement viewer runtime에 연결하는 방법을 정리한다. 현재 완료된 단계는 asset folder inspect, handoff `assetFolder` evidence, `ferrum-asset://...` preview URL, Add Sprite local thumbnail preview, initial runtime texture registration, draft Add Sprite preview/handoff 동기화, asset folder 변경 후 runtime texture reload, local image dimension metadata다. 다음 후보는 packaging/GUI 검증이다.

## 목표

- Tauri desktop placement viewer에서 선택한 asset folder 이미지를 WebView가 안전하게 fetch할 수 있게 한다.
- 기존 `@ferrum2d/ferrum-web`의 `AssetLoader`, `TextureRegistry`, `TextureManager`, `BrowserPlatformHost` 경로를 재사용한다.
- Rust core render command ABI를 바꾸지 않는다. Rust는 texture id 숫자만 알고, 실제 이미지 fetch/decode/WebGL upload는 TypeScript platform layer가 담당한다.
- Scene Placement/Object Authoring 범위만 다룬다. Behavior Recipe 본문, FSM/action graph, timeline editor는 다루지 않는다.

## 현재 상태 (Slice 1~4 완료)

- `apps/placement-viewer-desktop`는 project root와 scene-authoring JSON을 로컬 파일로 읽고 저장한다.
- project 기본 `<project>/public/assets` 또는 명시 asset folder를 inspect해 이미지 파일 목록, `texture-atlas.input.json` 존재 여부, missing/not-directory diagnostic을 handoff `assetFolder` evidence로 남긴다.
- Tauri desktop host는 inspected image를 session-local registry에 등록하고 `ferrum-asset://localhost/project/<asset-id>` custom protocol로 WebView preview가 fetch할 수 있게 한다.
- official placement viewer의 Add Sprite selector/preview는 desktop asset folder image를 built-in sprite asset provider와 병합해 thumbnail로 표시한다.
- desktop project open 시 official placement viewer는 Data Scene apply 전에 desktop asset folder image manifest를 built-in texture manifest와 병합해 `runtime.engine.loadAssets(...)`로 등록한다.
- Add Sprite pending/draft marker는 선택된 local asset의 thumbnail/size를 사용하고 draft patch/handoff는 같은 local asset id를 유지한다.
- app bootstrap 이후 사용자가 다른 asset folder를 선택하면 official placement viewer는 새 image manifest를 낮은 빈도 `runtime.engine.loadAssets(...)` refresh로 등록하고 handoff/Inspector 상태를 갱신한다.
- `.ferrum-placement-handoff.json`은 선택/draft/asset folder 상태를 debounce 후 자동 sync한다.
- `pnpm smoke:placement-viewer-desktop-assets`는 fake Tauri bridge로 desktop project open과 asset folder 교체를 재현하고 local texture id, runtime reload status, Add Sprite pending/draft marker, draft patch, handoff `runtimeUrl`, canvas readback을 함께 검증한다.

## 비목표

- full visual editor, tile painting, sprite sheet slicing UI를 만들지 않는다.
- runtime frame loop에 파일 탐색이나 entity별 JS/Wasm 호출을 추가하지 않는다.
- Rust core가 로컬 파일, URL, WebGL/WebGPU API를 직접 다루지 않는다.
- scene-authoring 문서를 asset folder 선택만으로 자동 수정하지 않는다.
- npm/browser-only placement viewer에 desktop-only 로컬 파일 권한을 강제하지 않는다.

## 권장 아키텍처

### 1. Tauri asset URL provider (완료)

Tauri desktop shell은 로컬 asset file을 WebView에서 fetch 가능한 URL로 노출한다. 구현 후보는 다음 순서로 판단한다.

| 후보 | 판단 |
| --- | --- |
| Tauri custom protocol | 기본 추천. absolute file path를 DOM과 persisted JSON에 직접 노출하지 않고, project asset allowlist를 Rust command가 관리할 수 있다. |
| Vite dev server static route | dev smoke에는 쉽지만 packaged `.app`에서 같은 경로를 보장하기 어렵다. spike fallback 정도로만 둔다. |
| `file://` direct URL | WebView 보안/CORS/권한 차이가 크고 path 노출이 커서 기본값으로 쓰지 않는다. |
| base64/data URL | 작은 preview에는 가능하지만 큰 atlas나 다수 texture에 부적합하다. runtime texture loading 기본값으로 쓰지 않는다. |

사용 URL shape:

```text
ferrum-asset://localhost/project/<asset-id>
```

Rust/Tauri 쪽은 session-local asset id를 asset folder 내 canonical path로 매핑한다. 요청 path는 반드시 현재 선택된 asset folder 하위 파일이어야 하며, `..` traversal과 symlink 탈출은 거부한다. Tauri custom protocol과 MIME 응답 API는 현재 로컬 dependency 계약에 맞춰 유지한다.

### 2. Desktop asset manifest 생성 (완료)

`inspect_placement_asset_folder`의 image list evidence에서 placement runtime용 manifest를 파생한다.

```ts
{
  textures: {
    "gui-smoke": "ferrum-asset://localhost/project/gui-smoke"
  }
}
```

규칙:

- texture name 기본값은 file stem이다.
- 같은 stem이 중복되면 deterministic suffix를 붙이거나 diagnostic을 반환한다. 조용히 덮어쓰지 않는다.
- `texture-atlas.input.json`이 있으면 texture id/name mapping의 source of truth로 우선한다.
- unsupported extension은 manifest에 넣지 않고 evidence에서 제외한다.

### 3. 기존 engine asset path 재사용 (완료)

runtime texture upload는 새 렌더러 경로를 만들지 않고 기존 API를 사용한다.

```ts
await runtime.engine.loadAssets({ textures: desktopAssetTextures });
```

이 경로는 이미 다음 책임을 갖는다.

- `AssetLoader`가 texture name을 `TextureRegistry`에 reserve한다.
- `TextureManager`/`WebGpuTextureStore`가 `fetch(url) -> blob -> createImageBitmap(...)`으로 decode/upload한다.
- Data Scene runtime target은 `engine.textureId(name)`으로 texture id를 해석한다.

현재 구현은 asset URL provider와 manifest 생성에 집중하고, WebGL2/WebGPU texture upload 자체는 기존 경로를 재사용한다.

## 구현 slice

### Slice 1. Preview-only texture loading

상태: 완료.

목표:

- `assetFolder.images[]`를 `ferrum-asset://...` URL이 포함된 desktop asset manifest로 변환한다.
- official placement viewer의 Add Sprite selector/preview가 local asset thumbnail을 표시한다.
- Handoff `assetFolder.images[]`에 `runtimeUrl` evidence를 추가한다. absolute path는 기존 `path` evidence에만 남고, preview/runtime fetch에는 virtual URL을 사용한다.

검증:

- `pnpm --filter @ferrum2d/placement-viewer build`
- `pnpm --filter @ferrum2d/placement-viewer-desktop test`
- 실제 Tauri GUI에서 asset folder의 PNG가 Add Sprite preview에 표시되는지 확인

### Slice 2. Initial runtime texture registration

상태: 완료.

목표:

- desktop project open 시 Data Scene apply 전에 local asset textures를 `runtime.engine.loadAssets(...)`로 등록한다.
- scene-authoring의 `visual.kind: "sprite"` asset reference가 local asset name을 가리킬 때 canvas runtime에서도 해당 texture를 사용한다.
- missing texture는 기존 asset diagnostic으로 남긴다.

검증:

- `pnpm smoke:placement-viewer-desktop-assets`로 local asset을 참조하는 test scene-authoring fixture의 nonblank canvas, correct texture registration, handoff `runtimeUrl` evidence 확인
- browser smoke는 desktop-only 경로 없이 계속 통과
- runtime hot path에 per-entity JS/Wasm call이 추가되지 않았는지 review

### Slice 3. Draft Add Sprite runtime refresh

상태: 완료.

목표:

- Add Sprite로 local asset draft를 만들 때 viewer state, handoff, canvas preview가 같은 texture name을 사용한다.
- 저장 전 draft는 여전히 `ScenePlacementPatch`로만 유지한다.
- scene-authoring 저장은 기존 Save Draft action을 통해서만 발생한다.

검증:

- `pnpm smoke:placement-viewer-desktop-assets`가 Add Sprite local asset pending marker와 draft marker의 thumbnail/size evidence를 확인한다.
- Add Sprite local asset draft patch가 `props.components.visual.kind: "sprite"`와 asset name을 포함한다.
- handoff draftPatch와 assetFolder evidence가 같은 asset id를 가리킨다.
- Save Draft 전 원본 scene-authoring 파일은 수정되지 않는다.

### Slice 4. Asset folder runtime reload

상태: 완료.

목표:

- app bootstrap 이후 사용자가 다른 asset folder를 선택해도 새 image manifest를 낮은 빈도 `runtime.engine.loadAssets(...)` refresh로 등록한다.
- 이미 생성된 draft patch와 pending Add Sprite preview는 새 provider 상태와 충돌하지 않는다.
- refresh 실패는 handoff/Inspector diagnostic으로 남기고 frame loop는 계속 유지한다.

검증:

- `pnpm smoke:placement-viewer-desktop-assets`가 initial local texture registration 이후 다른 fake asset folder를 열고, 새 local texture id/runtime manifest/handoff `runtimeUrl`/Add Sprite draft patch가 같은 asset id로 동기화되는지 확인한다.

### 후속 후보. Packaging/GUI 검증과 metadata 완료 기록

- **승인 필요**: 실제 Tauri GUI에서 native asset folder picker, custom protocol fetch, packaged `.app` 실행, handoff 자동 sync 상태를 확인하고 release gate 편입 여부를 결정한다.
- **완료 (2026-07-15)**: official viewer가 local image `runtimeUrl`을 저빈도 `createImageBitmap(...)` 경로로 decode해 실제 width/height를 preview asset provider와 handoff evidence에 연결한다. Add Sprite visual과 AABB collider는 이 크기를 사용하고 metadata가 없으면 기존 default size로 fallback한다. `pnpm smoke:placement-viewer-desktop-assets`는 initial/reload PNG의 실제 크기와 draft patch를 검증한다.

## 보안과 경계

- asset URL provider는 선택된 asset folder 하위 image만 제공한다.
- request path는 canonicalize 후 allowlist root와 prefix check를 수행한다.
- MIME type은 extension allowlist 기반으로 제한한다.
- WebView `fetch(...)`/texture decode 경로에서 custom protocol image를 읽을 수 있도록 protocol 응답은 `Access-Control-Allow-Origin: *`와 GET/HEAD/OPTIONS CORS header를 포함한다.
- WebView/DOM에는 가능하면 virtual URL과 logical asset id를 노출하고, absolute file path는 Inspector/handoff evidence의 명시 필드로만 제한한다.
- dev server fallback을 만들더라도 packaged Tauri custom protocol과 동일한 logical URL contract를 유지한다.

## 문서와 검증 갱신 조건

동적 texture loading을 구현할 때는 다음 문서를 함께 갱신한다.

- `docs/engine/user-guide.md`: desktop asset folder가 실제 preview/runtime texture로 연결되는 범위
- `docs/engine/public-api/authoring.md`: handoff 또는 asset provider public type이 바뀌는 경우
- `docs/development/quality/smoke-check.md`: desktop GUI 수동 검증과 새 smoke pass condition
- `docs/planning/object-authoring-tool-plan.md`: 완료 상태와 남은 packaging 판단

권장 검증:

```bash
pnpm --filter @ferrum2d/ferrum-web build
pnpm --filter @ferrum2d/placement-viewer build
pnpm --filter @ferrum2d/placement-viewer-desktop check
pnpm --filter @ferrum2d/placement-viewer-desktop test
pnpm lint
pnpm validate:docs-links
pnpm validate:public-api-surface
pnpm smoke:placement-viewer
pnpm smoke:placement-viewer-desktop-assets
```

Tauri custom protocol과 packaged asset access는 실제 GUI에서 별도 확인한다.
