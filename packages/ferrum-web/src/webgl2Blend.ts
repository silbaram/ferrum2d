/** Straight-alpha inputs accumulate premultiplied RGB in linear intermediate targets. */
export function setSpriteBlend(gl: WebGL2RenderingContext, linearTarget: boolean, additive = false): void {
  if (linearTarget) {
    gl.blendFuncSeparate(gl.SRC_ALPHA, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
  } else {
    gl.blendFunc(gl.SRC_ALPHA, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
  }
}
