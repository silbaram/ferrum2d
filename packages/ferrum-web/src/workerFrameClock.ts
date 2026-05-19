/** @deprecated Worker clock는 현재 MVP 범위 밖입니다. RAF 기반 GameLoop를 사용하세요. */
export interface FrameClock {
  start(onTick: (timestampMs: number) => void, onError?: () => void): void;
  stop(): void;
}

/** @deprecated Worker clock는 현재 MVP 범위 밖이므로 항상 null을 반환합니다. */
export function createWorkerFrameClock(): FrameClock | null {
  return null;
}
