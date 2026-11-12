import type { PhysicsEntitySnapshot, PhysicsBodyColliderSnapshot } from "@ferrum2d/ferrum-web/core";
import { setUiText, uiMessage, type UiContent } from "./placementLocale";

/** Bounded read-only native diagnostics; never predicts or resolves a collision in JS. */
export function createPlacementPhysicsSummary() {
  const element = document.createElement("section"), title = document.createElement("h4"), values = document.createElement("dl"), list = document.createElement("ol");
  element.className = "placement-physics-summary"; element.dataset.placementPhysicsSummary = "true";
  setUiText(title, "Physics"); element.append(title,values,list);
  const row = (label: string, value: UiContent) => {
    const dt = document.createElement("dt"), dd = document.createElement("dd"); setUiText(dt,label); setUiText(dd,value); values.append(dt,dd);
  };
  return { element, update(body: PhysicsEntitySnapshot | undefined, colliders: readonly PhysicsBodyColliderSnapshot[] = [], total = colliders.length) {
    values.replaceChildren(); list.replaceChildren();
    if (!body) { row("Body", "Visual only · no native physics body"); return; }
    row("Body", uiMessage("{0} · {1}", body.bodyType, uiMessage(body.bodyEnabled ? "Enabled" : "Disabled")));
    const span = body.heightSpan;
    row("Floor", span ? String(span.floorId ?? 0) : "No floor restriction");
    row("Height Range", span ? uiMessage("{0} – {1}", Number(span.elevation.toFixed(2)), Number((span.elevation+span.height).toFixed(2))) : "No height restriction");
    row("Velocity", uiMessage("X {0} · Y {1}", body.velocityX.toFixed(2), body.velocityY.toFixed(2)));
    row("Colliders", uiMessage("{0} / {1}", colliders.length,total));
    for (const collider of colliders) {
      const item = document.createElement("li"); item.dataset.colliderState = !collider.colliderEnabled ? "disabled" : collider.colliderIsTrigger ? "sensor" : "solid";
      setUiText(item, uiMessage("#{0} {1} · {2} · Category {3} · Mask {4}", collider.colliderIndex, collider.colliderType,
        uiMessage(!collider.colliderEnabled ? "Disabled" : collider.colliderIsTrigger ? "Sensor" : "Solid"),
        "0x"+collider.categoryBits.toString(16), "0x"+collider.maskBits.toString(16)));
      list.append(item);
    }
  } };
}
