import type { FerrumEngine, SpatialRenderBufferView } from "@ferrum2d/ferrum-web/core";
import type { GameplayEntityHandle } from "@ferrum2d/ferrum-web/authoring";
export interface LessonPoint {
    x: number;
    y: number;
    elevation?: number;
}
export type LessonPoses = Record<string, LessonPoint>;
/** One native bulk read at the observation rate; copy before projection/other Wasm calls. */
export function sampleLessonPoses(engine: FerrumEngine, handles: Record<string, GameplayEntityHandle>, names: readonly string[]): LessonPoses {
    const live = names.filter(name => !!handles[name]);
    if (!live.length)
        return {};
    const packet = engine.queryAudioPoseBuffer(new Uint32Array(live.flatMap(name => [handles[name].entityId, handles[name].entityGeneration])));
    const result: LessonPoses = {};
    live.forEach((name, index) => {
        const at = index * packet.stride;
        if (packet.words[at])
            result[name] = { x: packet.floats[at + 4], y: packet.floats[at + 5], elevation: packet.floats[at + 6] };
    });
    return result;
}
/** Display-only projection. Retain owned camera numbers, never a borrowed Wasm view. */
export function lessonSpatialProjector(canvas: HTMLCanvasElement, frame: SpatialRenderBufferView) {
    const matrix = Array.from(frame.camera), presentation = frame.presentation ? Array.from(frame.presentation) : undefined;
    return (point: LessonPoint) => {
        const p = [point.x, point.elevation ?? 0, -point.y, 1];
        const clip = [0, 1, 3].map(row => p.reduce((sum, value, column) => sum + matrix[column * 4 + row] * value, 0));
        if (!(clip[2] > 0))
            return undefined;
        const cropped = presentation && presentation[4] > 0;
        const width = canvas.clientWidth * (cropped ? presentation[2] : 1), height = canvas.clientHeight * (cropped ? presentation[3] : 1);
        return { x: (cropped ? presentation[0] * canvas.clientWidth : 0) + (clip[0] / clip[2] + 1) * width / 2,
            y: (cropped ? presentation[1] * canvas.clientHeight : 0) + (1 - clip[1] / clip[2]) * height / 2 };
    };
}
