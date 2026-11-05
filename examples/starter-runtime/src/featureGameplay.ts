import {
  captureGameStateSnapshot, loadGameStateSnapshotFromStorage, restoreGameStateSnapshot,
  saveGameStateSnapshotToStorage, removeGameStateSnapshotFromStorage,
} from "@ferrum2d/ferrum-web/core";
import { createSceneInstanceHandleRegistry, ScreenFadeTransition, type SceneAuthoringDocumentSpec } from "@ferrum2d/ferrum-web/authoring";
import { readFeatureSavePosition } from "./featureSave";
import { nativePosition, type FeatureContext, type FeatureExtra } from "./featureExtras";

export const gameplayControls: Record<string, string> = {
  scenes: `<div class="feature-buttons"><button data-control="count">카운터 +1</button><button data-control="next-scene">다음 공간</button></div><output data-value="gameplay-status" role="status">A 공간 · 에너지 표식</output>`,
  interaction: `<div class="feature-buttons"><button data-move="224,208">스위치 앞으로</button><button data-move="480,208">문 앞으로</button><button data-move="320,272">구역 안으로</button><button data-move="128,192">구역 밖으로</button></div><button data-control="interact">상호작용 · Space</button><output data-value="gameplay-status" role="status">스위치로 문 사용 조건을 해제하세요.</output><p>문은 조건부 상호작용 표식입니다. 벽 충돌을 여닫는 예제는 타일맵 항목에서 확인하세요.</p>`,
  "save-load": `<div class="feature-buttons"><button data-move="448,192">에너지 수집</button><button data-move="128,192">출발점으로</button></div><div class="feature-buttons"><button data-control="save">저장</button><button data-control="load">불러오기</button><button data-control="delete-save">저장 삭제</button></div><output data-value="gameplay-status" role="status">이 실험만의 브라우저 저장 슬롯을 사용합니다.</output>`,
};
export const gameplayHelp: Record<string, string> = {
  scenes: "A: 에너지 표식 / B: 공 표식 · 전환 중에는 새 전환을 시작하지 않습니다.",
  interaction: "바닥 클릭으로 이동 · 장치 64 단위 안에서 Space 또는 상호작용 · 아래 테두리 패널이 트리거 구역입니다.",
  "save-load": "바닥 클릭으로 이동 · 수집하면 에너지 표식이 사라집니다. 저장 후 새로고침하고 불러오세요.",
};
const SAVE_KEY = "ferrum2d.feature-lab.save-load.v1";

export function createGameplayFeature(ctx: FeatureContext): FeatureExtra | undefined {
  if (!(ctx.id in gameplayControls)) return undefined;
  const { id, root, runtime, canvas, signal } = ctx, engine = runtime.engine, scene = runtime.dataScene!;
  const source = ctx.source as SceneAuthoringDocumentSpec;
  const status = (text: string) => { root.querySelector('[data-value="gameplay-status"]')!.textContent = text; };
  const on = (key: string, fn: () => void) => root.querySelector(`[data-control="${key}"]`)!.addEventListener("click", fn, { signal });
  const active = () => { if (ctx.playing()) return true; status("계속하기를 누른 뒤 실행하세요."); return false; };
  const extra: FeatureExtra = { reset() {}, frame() {}, observation: () => "", snapshot: () => ({}), pause() {}, destroy() {} };
  if (id === "scenes") {
    let room = "lab", phase: "idle" | "out" | "in" = "idle";
    const fade = ScreenFadeTransition.create({ fromOpacity: 0, toOpacity: 1, durationSeconds: .45 });
    on("count", () => {
      if (!active() || phase !== "idle") return;
      for (const name of ["local", "total"]) scene.variables.set(name, Number(scene.variables.get(name)) + 1);
    });
    on("next-scene", () => {
      if (!active() || phase !== "idle") return;
      phase = "out"; fade.reset({ fromOpacity: 0, toOpacity: 1, durationSeconds: .45 });
      status("암전 중… 일시정지하면 전환도 멈춥니다.");
    });
    extra.frame = frame => {
      if (!ctx.playing() || phase === "idle") return;
      if (fade.update(frame.frameTimeMs / 1000).active) return;
      if (phase === "out") {
        room = room === "lab" ? "other" : "lab";
        scene.transition({ ...source, sceneComposition: { ...source.sceneComposition, initialFragment: room } });
        ctx.configureView();
        phase = "in"; fade.reset({ fromOpacity: 1, toOpacity: 0, durationSeconds: .45 });
      } else { phase = "idle"; status(room === "lab" ? "A 공간 · 에너지 표식" : "B 공간 · 공 표식"); }
    };
    extra.postProcess = () => phase === "idle" ? false : fade.postProcessPasses();
    extra.reset = () => { room = "lab"; phase = "idle"; scene.variables.set("total", 0); status("A 공간 · 에너지 표식"); };
    extra.observation = () => `${room === "lab" ? "A" : "B"} 공간 · 씬 카운터 ${scene.variables.get("local")} · 전역 카운터 ${scene.variables.get("total")}`;
    extra.snapshot = () => ({ transition: { room, phase, opacity: phase === "idle" ? 0 : fade.snapshot().opacity, local: scene.variables.get("local"), total: scene.variables.get("total") } });
    return extra;
  }

  // A restore re-creates native entities. Resolve current generations via a registry, never cached handles.
  const registry = createSceneInstanceHandleRegistry({ entityExists: handle => engine.gameplayEntityExists(handle) });
  const handle = (name: string) => registry.get(name, { validateLive: true });
  const register = () => { registry.clear(); for (const [name, entity] of Object.entries(scene.result.entityHandles)) registry.set(name, entity); };
  const move = (point: { x: number; y: number }) => {
    if (!active()) return;
    status(engine.moveDataSceneActorTo({ ...point, speed: 200, arrivalRadius: 1, cancelOnInput: false }) ? "목적지로 이동합니다." : "이동할 수 없는 목적지입니다.");
  };
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-move]")) button.addEventListener("click", () => {
    const [x, y] = button.dataset.move!.split(",").map(Number); move({ x, y });
  }, { signal });
  canvas.addEventListener("pointerdown", event => { if (event.button === 0) { canvas.focus(); move(ctx.worldPoint(event)); } }, { signal });
  extra.reset = register;
  extra.destroy = () => registry.clear();
  if (id === "interaction") {
    let enter = 0, exit = 0, queued = false, release = false;
    on("interact", () => { if (active()) { queued = true; status("근처 장치에 상호작용을 요청했습니다. 조건과 결과를 확인하세요."); } });
    extra.input = snapshot => {
      // One press and one release even if the button is clicked faster than a render frame.
      if (release) { release = false; return { ...snapshot, space: false }; }
      if (!queued || !ctx.playing()) return snapshot;
      queued = false; release = true; return { ...snapshot, space: true };
    };
    extra.reset = () => {
      register(); enter = 0; exit = 0; queued = false; release = false;
      runtime.input.clear();
      if (!engine.setInputActionBinding(91, 0, { control: "space", activation: "pressed" })) throw Error("상호작용 입력 설정 실패");
      status("스위치로 문 사용 조건을 해제하세요.");
    };
    extra.pause = () => { queued = false; release = false; runtime.input.clear(); };
    extra.frame = frame => {
      const zone = scene.result.entityHandles.zone, actor = scene.result.entityHandles.robot;
      for (const event of frame.collisionEvents) {
        const aZone = event.aId === zone.entityId && event.aGeneration === zone.entityGeneration;
        const bZone = event.bId === zone.entityId && event.bGeneration === zone.entityGeneration;
        const aActor = event.aId === actor.entityId && event.aGeneration === actor.entityGeneration;
        const bActor = event.bId === actor.entityId && event.bGeneration === actor.entityGeneration;
        if (!(aZone && bActor || bZone && aActor)) continue;
        if (event.kind === "trigger-enter") enter++;
        if (event.kind === "trigger-exit") exit++;
      }
      for (const event of frame.gameplayEvents) if (event.kind === "interaction") status(event.tokenId === 17 ? "스위치 작동 · 문 사용 가능" : "문 사용 성공");
    };
    extra.observation = () => `문 조건: ${scene.variables.get("unlocked") ? "해제" : "잠김"} · 사용 ${scene.variables.get("uses")}회 · 구역 진입 ${enter} / 이탈 ${exit}`;
    extra.snapshot = () => ({ actor: nativePosition(runtime, handle("robot")), interaction: { unlocked: scene.variables.get("unlocked"), uses: scene.variables.get("uses"), enter, exit } });
  } else {
    let lastOperation = "none", lastError: string | undefined;
    // This exact authored fixture is the only document this isolated slot accepts.
    const serializedSource = JSON.stringify(source);
    const operation = (key: string, action: () => string) => on(key, () => {
      if (!active()) return;
      try { status(action()); lastOperation = key; lastError = undefined; }
      catch (error) { lastError = error instanceof Error ? error.message : String(error); lastOperation = "error"; status("저장 작업 실패: 저장소 사용 권한 또는 이 실험의 저장 데이터가 올바른지 확인하세요."); }
    });
    operation("save", () => {
      const actor = nativePosition(runtime, handle("robot"));
      if (!actor) throw Error("저장할 캐릭터가 없습니다.");
      // Data Scene progress saves removals/variables; ordinary 2D poses use the custom-state extension.
      const snapshot = captureGameStateSnapshot(engine, { includeDataSceneState: true, includeDataSceneProgress: true, dataSceneAuthoringDocument: JSON.parse(serializedSource), dataSceneCustomState: { actor } });
      saveGameStateSnapshotToStorage(localStorage, SAVE_KEY, snapshot); return "위치와 수집 진행을 저장했습니다.";
    });
    operation("load", () => {
      const snapshot = loadGameStateSnapshotFromStorage(localStorage, SAVE_KEY);
      if (!snapshot) return "저장된 데이터가 없습니다.";
      const { x, y } = readFeatureSavePosition(snapshot, serializedSource);
      restoreGameStateSnapshot(engine, snapshot, { dataSceneAuthoringApplyOptions: { instanceHandleRegistry: registry },
        applyDataSceneCustomState: () => {
          if (!engine.setPhysicsBodyPosition(registry.require("robot", { validateLive: true }), x, y)) throw Error("캐릭터 위치 복원 실패");
        },
      });
      runtime.input.clear(); ctx.configureView(); return "위치와 수집 진행을 복원했습니다.";
    });
    operation("delete-save", () => { removeGameStateSnapshotFromStorage(localStorage, SAVE_KEY); return "이 실험의 저장 슬롯을 삭제했습니다."; });
    extra.reset = () => { register(); lastOperation = "none"; lastError = undefined; status("초기 상태로 돌아왔습니다. 저장 슬롯은 유지합니다."); };
    extra.observation = () => `수집 ${scene.variables.get("collected")} / 1 · 저장 대상: 위치·변수·수집 진행`;
    extra.snapshot = () => {
      const actor = handle("robot");
      return { actor: nativePosition(runtime, actor), animation: actor && engine.dataSceneSpriteAnimationState(actor),
        save: { key: SAVE_KEY, lastOperation, error: lastError, collected: scene.variables.get("collected"), energyPresent: !!handle("energy") } };
    };
  }
  return extra;
}
