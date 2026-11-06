import { UiOverlay, type UiOverlayState } from "@ferrum2d/ferrum-web/core";
import { DialogueSession, QuestLog, LocalizationBundle, createHudOverlayState, dialogueNodeToUiOverlayState, resolveAccessibilityHudTheme } from "@ferrum2d/ferrum-web/authoring";
import type { FeatureContext, FeatureExtra } from "./featureExtras";

export const contentControls: Record<string, string> = {
  dialogue: `<p>캔버스 아래 대화 패널에서 선택하세요. Tab으로 이동하고 Enter로 결정할 수 있습니다.</p><output data-value="quest-status" role="status">퀘스트: 시작 전</output>`,
  hud: `<div class="feature-buttons"><button data-control="damage">피해 −25</button><button data-control="heal">회복 +25</button></div>
    <label>HUD 언어<select data-control="locale"><option value="ko">한국어</option><option value="en">English</option></select></label>
    <label>HUD 글자 크기<select data-control="text-size"><option value="14">기본 · 14px</option><option value="18">크게 · 18px</option><option value="22">더 크게 · 22px</option></select></label>
    <label>HUD 대비<select data-control="contrast"><option value="default">기본</option><option value="high-contrast">높은 대비</option></select></label>`,
};
export const contentHelp: Record<string, string> = {
  dialogue: "아래는 엔진 UiOverlay가 생성한 대화 UI입니다. 일시정지하면 선택도 멈춥니다.",
  hud: "아래 HUD가 실제 엔진 체력 변수를 표시합니다. 언어·글자·대비 설정은 이 HUD에 적용됩니다.",
};

export function createContentFeature(ctx: FeatureContext): FeatureExtra | undefined {
  if (!(ctx.id in contentControls)) return undefined;
  const { id, root, canvas, runtime, signal } = ctx;
  const preview = document.createElement("section");
  preview.className = "feature-content-preview";
  preview.setAttribute("aria-label", id === "dialogue" ? "대화 플레이 화면" : "HUD 표시 화면");
  preview.tabIndex = -1;
  canvas.parentElement!.append(preview);
  let overlay: UiOverlay | undefined;
  const extra: FeatureExtra = { reset() {}, frame() {}, observation: () => "", snapshot: () => ({}), pause() {}, destroy: () => { overlay?.destroy(); preview.remove(); } };
  const theme = { font: '14px "Feature Sans", system-ui, sans-serif', borderRadius: "3px", panelBackground: "#111821", panelBorder: "#2a3645", accentTextColor: "#f5a742", primaryButtonBackground: "#5c3b16" };
  if (id === "dialogue") {
    const quests = QuestLog.create({ quests: { delivery: { title: "작은 배달", stages: { parcel: { title: "소포 전달", objectives: { delivered: "소포를 전달하기" } } } } } });
    const session = DialogueSession.create({ initialNode: "hello", nodes: {
      hello: { speaker: "정원 관리인", text: "이 소포를 옆집에 전해 줄 수 있나요?", choices: [
        { id: "accept", label: "도와드릴게요", to: "work", questUpdates: [{ quest: "delivery", action: "start" }] },
        { id: "decline", label: "나중에 할게요", to: "declined" },
      ] },
      declined: { speaker: "정원 관리인", text: "괜찮아요. 준비되면 말해 주세요.", choices: [{ id: "retry", label: "다시 이야기하기", to: "hello" }] },
      work: { speaker: "정원 관리인", text: "먼저 소포를 챙기세요. 챙긴 뒤에 전달할 수 있습니다.", choices: [
        { id: "take", label: "소포 챙기기", to: "ready", setFlags: ["parcel"] },
        { id: "deliver", label: "소포 전달하기", to: "done", requireFlags: ["parcel"], questUpdates: [{ quest: "delivery", action: "completeObjective", stage: "parcel", objective: "delivered" }, { quest: "delivery", action: "complete" }] },
      ] },
      ready: { speaker: "이웃", text: "소포를 가지고 오셨군요!", choices: [
        { id: "deliver", label: "소포 전달하기", to: "done", requireFlags: ["parcel"], clearFlags: ["parcel"], questUpdates: [{ quest: "delivery", action: "completeObjective", stage: "parcel", objective: "delivered" }, { quest: "delivery", action: "complete" }] },
      ] },
      done: { speaker: "이웃", text: "고마워요! 작은 배달을 완료했습니다. 다른 선택은 실험 초기화 후 비교하세요.", end: true },
    } }, quests);
    const initialDialogue = session.snapshot(), initialQuests = quests.snapshot();
    const questText = () => { const quest = quests.snapshot().quests.find(q => q.id === "delivery"); return quest?.status === "completed" ? "완료 · 소포 전달 1 / 1" : quest?.status === "active" ? "진행 중 · 소포 전달 0 / 1" : "시작 전"; };
    const draw = () => {
      const state = dialogueNodeToUiOverlayState(session);
      const dialog = state.dialog!;
      overlay!.update({ dialog: { ...dialog, actions: session.snapshot().ended ? [] : dialog.actions?.map(action => ({ ...action, disabled: !ctx.playing() })) } });
      root.querySelector('[data-value="quest-status"]')!.textContent = `퀘스트: ${questText()}`;
    };
    overlay = new UiOverlay(preview, { theme, onAction: event => {
      if (!ctx.playing() || session.snapshot().ended) return;
      session.choose(event.id); draw();
      // Updating a dialogue replaces its buttons. Keep keyboard focus in this interaction.
      (preview.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? preview).focus({ preventScroll: true });
    } });
    const destroyContent = extra.destroy;
    extra.destroy = () => { session.destroy(); quests.destroy(); destroyContent?.(); };
    extra.reset = () => { session.restore(initialDialogue); quests.restore(initialQuests); draw(); };
    extra.pause = draw;
    extra.observation = () => `대화: ${session.currentNode().speaker} · 퀘스트 ${questText()}`;
    extra.snapshot = () => ({ dialogue: session.snapshot(), quests: quests.snapshot(), choices: session.snapshot().ended ? [] : session.availableChoices().map(choice => choice.id) });
    return extra;
  }

  const bundle = LocalizationBundle.create({ defaultLocale: "ko", fallbackLocale: "en", locales: {
    ko: { strings: { title: "정원 탐험", health: "체력", state: "상태", healthy: "탐험 중", tired: "휴식이 필요해요" } },
    en: { strings: { title: "Garden Explorer", health: "Health", state: "Status", healthy: "Exploring", tired: "Time to rest" } },
  } }, "ko");
  const control = <T extends HTMLElement>(key: string) => root.querySelector<T>(`[data-control="${key}"]`)!;
  const value = (key: string) => control<HTMLSelectElement>(key).value;
  const health = () => Number(runtime.dataScene!.variables.get("health"));
  const state = (): UiOverlayState => createHudOverlayState([
    { id: "health", type: "meter", label: bundle.t("health"), value: health(), max: 100 },
    { id: "state", type: "counter", label: bundle.t("state"), value: bundle.t(health() > 25 ? "healthy" : "tired") },
  ], { panelId: "health", title: bundle.t("title"), region: "center", ariaLabel: bundle.t("title"), ariaLive: "polite" });
  const draw = () => overlay!.update(state());
  const rebuild = () => {
    bundle.setLocale(value("locale")); preview.lang = bundle.locale();
    overlay?.destroy();
    const contrast = value("contrast") === "high-contrast" ? "high-contrast" : "default";
    overlay = new UiOverlay(preview, { theme: { ...theme, ...resolveAccessibilityHudTheme({ contrastPalette: contrast }), font: `${value("text-size")}px "Feature Sans", system-ui, sans-serif`, borderRadius: "3px" } });
    draw();
  };
  for (const key of ["locale", "text-size", "contrast"]) control(key).addEventListener("change", rebuild, { signal });
  for (const [key, amount] of [["damage", -25], ["heal", 25]] as const) control(key).addEventListener("click", () => {
    if (!ctx.playing()) return;
    runtime.dataScene!.variables.set("health", Math.max(0, Math.min(100, health() + amount))); draw();
  }, { signal });
  extra.reset = rebuild;
  extra.observation = () => `체력 ${health()} / 100 · ${bundle.locale()} · ${value("text-size")}px · ${value("contrast") === "default" ? "기본 대비" : "높은 대비"}`;
  extra.snapshot = () => ({ hud: { health: health(), locale: bundle.locale(), textSize: Number(value("text-size")), contrast: value("contrast") } });
  return extra;
}
