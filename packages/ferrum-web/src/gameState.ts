export const GAME_STATE_CODE = Object.freeze({
  title: 0,
  playing: 1,
  gameOver: 2,
  paused: 3,
  levelComplete: 4,
} as const);

export type GameStateName = keyof typeof GAME_STATE_CODE;
export type GameStateCode = (typeof GAME_STATE_CODE)[GameStateName];
export type DataSceneGameState = Extract<
  GameStateName,
  "playing" | "paused" | "levelComplete"
>;

const DATA_SCENE_GAME_STATE_UNAVAILABLE_CODE = 0xffffffff;

const GAME_STATE_NAME_BY_CODE: Readonly<Record<GameStateCode, GameStateName>> = Object.freeze({
  [GAME_STATE_CODE.title]: "title",
  [GAME_STATE_CODE.playing]: "playing",
  [GAME_STATE_CODE.gameOver]: "gameOver",
  [GAME_STATE_CODE.paused]: "paused",
  [GAME_STATE_CODE.levelComplete]: "levelComplete",
});

export function resolveGameStateCode(value: unknown, path = "gameState"): GameStateCode {
  if (typeof value !== "number" || !Number.isInteger(value) || !(value in GAME_STATE_NAME_BY_CODE)) {
    throw new Error(`${path} must be a known game state code (0..4).`);
  }
  return value as GameStateCode;
}

export function gameStateName(code: GameStateCode): GameStateName {
  return GAME_STATE_NAME_BY_CODE[resolveGameStateCode(code)];
}

export function dataSceneGameStateFromCode(code: number): DataSceneGameState | undefined {
  switch (code) {
    case GAME_STATE_CODE.playing:
      return "playing";
    case GAME_STATE_CODE.paused:
      return "paused";
    case GAME_STATE_CODE.levelComplete:
      return "levelComplete";
    default:
      return undefined;
  }
}

export function resolveDataSceneGameState(
  value: unknown,
  path = "dataSceneGameState",
): DataSceneGameState | undefined {
  if (value === DATA_SCENE_GAME_STATE_UNAVAILABLE_CODE) {
    return undefined;
  }
  const state = dataSceneGameStateFromCode(resolveGameStateCode(value, path));
  if (state === undefined) {
    throw new Error(
      `${path} must be playing (1), paused (3), levelComplete (4), or unavailable (4294967295).`,
    );
  }
  return state;
}
