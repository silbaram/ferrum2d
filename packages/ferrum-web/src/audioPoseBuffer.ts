/** Independent native query ABI v1. Rows: [valid,id,generation,floor,x,y,elevation,yawRadians]. */
export interface AudioPoseBufferView {
  count: number;
  stride: 8;
  /** Words 0..3 of each row are u32; word 3 is authored floor metadata, not extra distance. */
  words: Uint32Array;
  /** Words 4..7 of each row are f32 in game world coordinates. */
  floats: Float32Array;
}
