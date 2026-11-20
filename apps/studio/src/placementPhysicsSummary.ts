import type { PhysicsEntitySnapshot, PhysicsBodyColliderSnapshot, PhysicsKinematicControllerOptions } from "@ferrum2d/ferrum-web/core";
import { setUiText, uiMessage, type UiContent } from "./placementLocale";

export interface PlacementShapePhysicsSnapshot {
  kind: string;
  position: readonly number[];
  rotation: readonly number[];
  velocity: readonly number[];
  angularVelocity: readonly number[];
  sleeping: boolean;
  colliderCount: number;
  character?: { grounded: boolean; sliding: boolean; verticalSpeed: number };
}

/** Authored JSON is not evidence that a runtime controller was admitted or installed. */
export interface PlacementPhysicsAuthoringSnapshot {
  nativeBody?: boolean;
  kinematicController?: PhysicsKinematicControllerOptions;
  runtimeError?: string;
  characterRuntimeError?: string;
}

/** Bounded read-only native diagnostics; never predicts or resolves a collision in JS. */
export function createPlacementPhysicsSummary() {
  const element = document.createElement("section"), title = document.createElement("h4"), values = document.createElement("dl"), list = document.createElement("ol");
  element.className = "placement-physics-summary"; element.dataset.placementPhysicsSummary = "true";
  setUiText(title, "Physics"); element.append(title,values,list);
  const row = (label: string, value: UiContent) => {
    const dt = document.createElement("dt"), dd = document.createElement("dd"); setUiText(dt,label); setUiText(dd,value); values.append(dt,dd);
  };
  return { element, update(body: PhysicsEntitySnapshot | undefined, colliders: readonly PhysicsBodyColliderSnapshot[] = [], total = colliders.length, shapeBody?: PlacementShapePhysicsSnapshot, authored?: PlacementPhysicsAuthoringSnapshot) {
    values.replaceChildren(); list.replaceChildren();
    if (authored?.kinematicController) {
      row("Kinematic Controller", "Authored · runtime application unknown");
      // Keep omission and explicit false/zero visible; do not substitute runtime defaults.
      row("JSON Settings", JSON.stringify(authored.kinematicController));
    }
    if (authored?.runtimeError) row("Physics Read", uiMessage("Unavailable · {0}", authored.runtimeError));
    if (authored?.characterRuntimeError) row("Character Read", uiMessage("Unavailable · {0}", authored.characterRuntimeError));
    if (shapeBody) {
      row("Body", uiMessage("{0} · {1}", shapeBody.kind, uiMessage(shapeBody.sleeping ? "Sleeping" : "Awake")));
      const xyz = (v: readonly number[]) => uiMessage("X {0} · Y {1} · Z {2}", ...v.map(n => n.toFixed(2)));
      row("Position", xyz(shapeBody.position)); row("Velocity", xyz(shapeBody.velocity));
      row("Quaternion", uiMessage("X {0} · Y {1} · Z {2} · W {3}", ...shapeBody.rotation.map(n => n.toFixed(3))));
      row("Angular Velocity", xyz(shapeBody.angularVelocity));
      row("Colliders", String(shapeBody.colliderCount));
      if (shapeBody.character) {
        row("Grounded", String(shapeBody.character.grounded));
        row("Sliding", String(shapeBody.character.sliding));
        row("Vertical Speed", shapeBody.character.verticalSpeed.toFixed(2));
      }
      return;
    }
    if (authored?.nativeBody) { row("Body", "Native body authored · runtime state unavailable"); return; }
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
