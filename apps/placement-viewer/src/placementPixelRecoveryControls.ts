import { setUiText, uiMessage } from "./placementLocale";
import type { createPixelRecoverySession } from "./placementPixelRecoverySession";

export function createPixelRecoveryControls(options: {
  recovery: ReturnType<typeof createPixelRecoverySession>;
  restore(id: string): void;
}) {
  const element = document.createElement("details"), summary = document.createElement("summary");
  element.className = "placement-pixel-recovery"; element.dataset.pixelRecovery = "true";
  const panel = document.createElement("div"), status = document.createElement("output"), list = document.createElement("div");
  status.setAttribute("role", "status"); status.dataset.pixelRecoveryStatus = "true";
  const hint = document.createElement("p"); setUiText(hint, "Local drafts only. Restoring does not change the scene.");
  const retention = document.createElement("p"); setUiText(retention, "Up to 8 drafts · 32 MiB · 7 days. Oldest drafts expire first.");
  const refresh = document.createElement("button"); refresh.type = "button"; setUiText(refresh, "Refresh");
  refresh.dataset.pixelAction = "recovery-refresh"; refresh.onclick = () => options.recovery.retry();
  panel.append(hint, status, list, retention, refresh); element.append(summary, panel);
  let frame = 0;
  function position() {
    frame = 0;
    const bounds = element.closest(".placement-pixel-workspace")?.getBoundingClientRect();
    if (!element.open || !bounds) return;
    const anchor = element.getBoundingClientRect(), width = panel.getBoundingClientRect().width;
    panel.style.left = Math.max(bounds.left + 4 - anchor.left, Math.min(0, bounds.right - 4 - width - anchor.left)) + "px";
    const below = bounds.bottom - anchor.bottom - 4, above = anchor.top - bounds.top - 4;
    const up = below < 128 && above > below;
    panel.style.top = up ? "auto" : "100%"; panel.style.bottom = up ? "100%" : "auto";
    panel.style.maxHeight = Math.max(48, Math.min(320, up ? above : below)) + "px";
  }
  function reposition() { if (!frame) frame = requestAnimationFrame(position); }
  const resize = new ResizeObserver(reposition); resize.observe(element);
  const outside = (event: PointerEvent) => { if (event.target instanceof Node && !element.contains(event.target)) element.open = false; };
  window.addEventListener("resize", reposition); window.addEventListener("pointerdown", outside, true);
  element.addEventListener("toggle", () => { if (element.open) { reposition(); void options.recovery.refresh(); } });
  element.addEventListener("keydown", event => {
    if (event.code === "Escape" && element.open) { event.preventDefault(); event.stopPropagation(); element.open = false; summary.focus(); }
  });
  let signature = "";
  return {
    element,
    sync(disabled: boolean) {
      const state = options.recovery.state();
      const failed = state.status.startsWith("Local recovery");
      setUiText(summary, failed ? "Recovery Unavailable" : uiMessage("Recovery ({0})", state.entries.length));
      setUiText(status, state.status || (state.entries.length ? "Choose a draft to restore." : "No completed local checkpoint yet."));
      if (element.open) reposition();
      const next = JSON.stringify([state.entries, disabled]);
      if (next === signature) return;
      signature = next; list.replaceChildren();
      if (!state.entries.length) { const empty = document.createElement("p"); setUiText(empty, "No recovery drafts in this scene."); list.append(empty); }
      for (const entry of state.entries) {
        const row = document.createElement("div"), title = document.createElement("strong"), time = document.createElement("time");
        row.className = "placement-pixel-recovery-row"; row.dataset.pixelRecoveryId = entry.id;
        title.textContent = entry.name; time.dateTime = new Date(entry.updatedAt).toISOString(); time.textContent = new Date(entry.updatedAt).toLocaleString();
        const actions = document.createElement("div");
        for (const [action, label] of [["restore", "Restore Draft"], ["discard", "Discard Draft"]] as const) {
          const button = document.createElement("button"); button.type = "button"; button.disabled = disabled;
          button.dataset.pixelAction = "recovery-" + action; setUiText(button, label);
          button.onclick = () => action === "restore" ? options.restore(entry.id) : void options.recovery.discard(entry.id);
          actions.append(button);
        }
        row.append(title, time, actions); list.append(row);
      }
    },
    destroy() { resize.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("resize", reposition); window.removeEventListener("pointerdown", outside, true); },
  };
}
