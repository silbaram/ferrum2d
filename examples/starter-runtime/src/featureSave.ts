import { DATA_SCENE_VARIABLES_SNAPSHOT_KEY, type GameStateSnapshot } from "@ferrum2d/ferrum-web/core";

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** The SDK accepts several snapshot forms. This lab needs a complete, playable collection checkpoint. */
export function readFeatureSavePosition(snapshot: GameStateSnapshot, expectedDocumentJson: string): { x: number; y: number } {
  // Called after SDK parsing/hash validation, before any live entity or variable is replaced.
  const data = snapshot.dataScene, progress = data?.progress;
  if (JSON.stringify(data?.authoringDocument) !== expectedDocumentJson || snapshot.scene.gameState !== 1 || data?.scene.gameState !== 1 ||
    !progress || !progress.navigation || snapshot.physics !== undefined || snapshot.builtInShooter !== undefined) {
    throw Error("이 실험의 완전한 진행 저장 데이터가 아닙니다.");
  }
  const actorState = progress.instances.find(instance => instance.id === "robot");
  const energyState = progress.instances.find(instance => instance.id === "energy");
  const custom = data.custom;
  const actor = record(custom) ? custom.actor : undefined;
  const variables = record(custom) ? custom[DATA_SCENE_VARIABLES_SNAPSHOT_KEY] : undefined;
  const collected = record(variables) ? variables.collected : undefined;
  if (!actorState || actorState.removed || actorState.bodyEnabled === false || actorState.colliderEnabled === false ||
    !energyState || typeof collected !== "number" || !Number.isInteger(collected) || collected < 0 || collected > 1 ||
    energyState.removed !== (collected === 1) ||
    (!energyState.removed && (energyState.bodyEnabled === false || energyState.colliderEnabled === false))) {
    throw Error("캐릭터 또는 수집 진행 정보가 누락되거나 서로 맞지 않습니다.");
  }
  if (!record(actor) || typeof actor.x !== "number" || typeof actor.y !== "number" || !Number.isFinite(actor.x) || !Number.isFinite(actor.y) ||
    actor.x < 16 || actor.x >= 624 || actor.y < 16 || actor.y >= 368) {
    throw Error("저장된 위치가 이동 가능한 범위가 아닙니다.");
  }
  return { x: actor.x, y: actor.y };
}
