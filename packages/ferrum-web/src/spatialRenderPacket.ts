import { validSpatialEnvironmentValues } from "./spatialEnvironment.js";
import type { SpatialRenderBufferView } from "./dataSceneSpatial.js";
/** Shared native geometry ABI validation. Renderer-specific material/resource checks follow. */
export function validateSpatialGeometryFrame(frame: SpatialRenderBufferView): number {
  if (
    ![frame.camera, frame.terrain, frame.billboards].every((v) => v instanceof Float32Array) ||
    !Number.isInteger(frame.terrainVertexCount) ||
    frame.terrainVertexCount < 0 ||
    !Number.isInteger(frame.billboardVertexCount) ||
    frame.billboardVertexCount < 0 ||
    (frame.version !== 1 && frame.version !== 2) ||
    frame.vertexStride !== 11 ||
    frame.camera.length !== 28 ||
    frame.terrain.length !== frame.terrainVertexCount * 11 ||
    frame.billboards.length !== frame.billboardVertexCount * 11 ||
    frame.terrainVertexCount % 3 ||
    frame.billboardVertexCount % 6
  )
    throw new Error("Invalid spatial render buffer");
  const ranges = frame.terrainDrawRanges;
  let terrainVertices = frame.terrainVertexCount;
  if (frame.version === 2) {
    if (
      !(ranges instanceof Uint32Array) ||
      ranges.length % 2 ||
      ranges.length > 512 ||
      frame.terrainVertexCount % 36 ||
      frame.terrainVertexCount > 256 * 36
    )
      throw new Error("Invalid spatial terrain draw ranges");
    let previousEnd = 0;
    terrainVertices = 0;
    for (let i = 0; i < ranges.length; i += 2) {
      const first = ranges[i],
        count = ranges[i + 1];
      if (
        first % 36 ||
        count === 0 ||
        count % 36 ||
        first < previousEnd ||
        first + count > frame.terrainVertexCount
      )
        throw new Error("Invalid spatial terrain draw range bounds");
      previousEnd = first + count;
      terrainVertices += count;
    }
  } else if (ranges !== undefined) {
    throw new Error("Spatial v1 packets cannot contain terrain draw ranges");
  }
  const presentation = frame.presentation;
  if (
    presentation &&
    (!(presentation instanceof Float32Array) ||
      presentation.length !== 6 ||
      presentation.some((x) => !Number.isFinite(x)) ||
      presentation[0] < 0 ||
      presentation[1] < 0 ||
      presentation[2] <= 0 ||
      presentation[3] <= 0 ||
      presentation[0] + presentation[2] > 1.00001 ||
      presentation[1] + presentation[3] > 1.00001)
  )
    throw new Error("Invalid spatial presentation viewport");
  if (
    [frame.camera, frame.terrain, frame.billboards].some(
      (buffer) => !(buffer instanceof Float32Array) || buffer.some((v) => !Number.isFinite(v)),
    )
  )
    throw new Error("Spatial buffer values must be finite");
  return terrainVertices;
}
/** Validate independent native extensions before backend resources are touched. */
export function validateSpatialExtensions(frame: SpatialRenderBufferView): void {
  const debug = frame.debug;
  if (
    debug !== undefined &&
    (!debug ||
      debug.version !== 1 ||
      debug.vertexStride !== 11 ||
      !(debug.vertices instanceof Float32Array) ||
      !Number.isInteger(debug.vertexCount) ||
      debug.vertexCount < 0 ||
      debug.vertexCount > 32768 ||
      debug.vertexCount % 2 !== 0 ||
      debug.vertices.length !== debug.vertexCount * 11 ||
      typeof debug.depthTest !== "boolean" ||
      typeof debug.truncated !== "boolean" ||
      debug.vertices.some((v) => !Number.isFinite(v)))
  )
    throw new Error("Invalid spatial debug buffer");
  const environment = frame.environment;
  if (
    environment !== undefined &&
    (!environment ||
      (environment.version !== 1 && environment.version !== 2 && environment.version !== 3 && environment.version !== 4) ||
      !(environment.values instanceof Float32Array) ||
      environment.values.length !== (environment.version === 1 ? 80 : environment.version === 2 ? 112 : environment.version === 3 ? 128 : 512) ||
      !validSpatialEnvironmentValues(environment.values) ||
      !(environment.shadowMatrices instanceof Float32Array) ||
      !(environment.shadowCasters instanceof Float32Array) ||
      !Number.isInteger(environment.shadowCasterVertexCount) ||
      environment.shadowCasterVertexCount < 0 ||
      environment.shadowCasterVertexCount % 6 !== 0 ||
      environment.shadowCasterVertexCount > 1024 * 6 ||
      environment.shadowCasters.length !== environment.shadowCasterVertexCount * 11 ||
      environment.shadowCasters.some((x) => !Number.isFinite(x)) ||
      environment.shadowMatrices.some((x) => !Number.isFinite(x)) ||
      environment.shadowMatrices.length !==
        (environment.values[2] >= 0 ? 96 : 0) +
          (environment.values.length > 80 && environment.values[92] > 0 ? 16 : 0) ||
      (environment.values[2] < 0 &&
        !(environment.values[92] > 0) &&
        environment.shadowCasterVertexCount !== 0))
  )
    throw new Error("Invalid spatial environment buffer");
  const submission = environment?.shadowSubmission;
  if (submission) {
    if (
      submission.version !== 1 ||
      !Number.isInteger(submission.revision) ||
      submission.revision < 0 ||
      submission.revision > 0xffffffff ||
      !(submission.ranges instanceof Uint32Array) ||
      submission.ranges.length % 4 ||
      submission.ranges.length > 35840
    )
      throw new Error("Invalid shadow submission buffer");
    let previousFace = -1,
      previousSource = -1,
      previousEnd = 0;
    const batches = new Uint32Array(7);
    for (let i = 0; i < submission.ranges.length; i += 4) {
      const [face, source, first, count] = submission.ranges.subarray(i, i + 4);
      const stride = source === 0 ? 36 : 6;
      const vertices = source === 0 ? frame.terrain : environment!.shadowCasters;
      if (
        face > 6 ||
        (face === 6 && !(environment!.values[92] > 0)) ||
        source > 1 ||
        count === 0 ||
        first % stride ||
        count % stride ||
        first + count > vertices.length / 11 ||
        face < previousFace ||
        (face === previousFace &&
          (source < previousSource || (source === previousSource && first < previousEnd)))
      )
        throw new Error("Invalid shadow submission range");
      let last = -1;
      for (let v = first * 11; v < (first + count) * 11; v += 33)
        if (vertices[v + 9] !== last) {
          batches[face]++;
          last = vertices[v + 9];
        }
      if (batches[face] > 64) throw new Error("Shadow face batch budget exceeded");
      previousFace = face;
      previousSource = source;
      previousEnd = first + count;
    }
  }
  if (environment && (environment.values[2] >= 0 || environment.values[92] > 0)) {
    if (frame.terrainVertexCount > 256 * 36)
      throw new Error("Spatial shadow terrain budget exceeded");
    let batches = 0;
    for (const vertices of [frame.terrain, environment.shadowCasters]) {
      let last = -1;
      for (let i = 0; i < vertices.length; i += 33) {
        const flags =
          vertices === frame.terrain
            ? (frame.materials?.terrain[Math.floor(i / 396) * 2 + 1] ?? 3)
            : 3;
        if (!(flags & 1)) {
          last = -1;
          continue;
        }
        if (vertices[i + 9] !== last) {
          batches++;
          last = vertices[i + 9];
        }
      }
    }
    if (batches > 64) throw new Error("Spatial shadow texture batch budget exceeded");
  }
}
