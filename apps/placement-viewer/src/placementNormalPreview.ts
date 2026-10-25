import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";
/** Isolated asset visualization. It does not update the game scene or simulation. */
export async function createPlacementNormalPreview(
  root: HTMLElement,
  colorBytes: ArrayBuffer,
  normalBytes: ArrayBuffer,
) {
  const figures = ["Color", "Normal", "Flat / Normal"].map((label) => {
    const figure = document.createElement("figure"),
      caption = document.createElement("figcaption"),
      canvas = document.createElement("canvas");
    setUiText(caption, label);
    canvas.width = label.includes("/") ? 384 : 192;
    canvas.height = 192;
    setUiAttribute(
      canvas,
      "aria-label",
      uiMessage("{0} preview", uiMessage(label)),
    );
    figure.append(canvas, caption);
    root.append(figure);
    return canvas;
  });
  const decoded = await Promise.allSettled([
    createImageBitmap(new Blob([colorBytes])),
    createImageBitmap(new Blob([normalBytes])),
  ]);
  if (decoded.some((value) => value.status === "rejected")) {
    for (const image of decoded)
      if (image.status === "fulfilled") image.value.close();
    throw new Error("Cannot decode the generated preview");
  }
  const color = (decoded[0] as PromiseFulfilledResult<ImageBitmap>).value,
    normal = (decoded[1] as PromiseFulfilledResult<ImageBitmap>).value;
  let cleanup = () => {},
    moving = false,
    disposed = false;
  try {
    for (const [i, image] of [color, normal].entries()) {
      const ctx = figures[i].getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      const scale = Math.min(192 / image.width, 192 / image.height);
      ctx.drawImage(
        image,
        (192 - image.width * scale) / 2,
        (192 - image.height * scale) / 2,
        image.width * scale,
        image.height * scale,
      );
    }
    const canvas = figures[2],
      gl = canvas.getContext("webgl2", {
        alpha: true,
        preserveDrawingBuffer: true,
      });
    if (!gl) throw new Error("Lighting preview requires WebGL2");
    const shaders: WebGLShader[] = [],
      textures: WebGLTexture[] = [];
    const program = gl.createProgram()!;
    let frame = 0;
    cleanup = () => {
      disposed = true;
      cancelAnimationFrame(frame);
      for (const t of textures) gl.deleteTexture(t);
      for (const s of shaders) gl.deleteShader(s);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
    for (const [kind, source] of [
      [
        gl.VERTEX_SHADER,
        `#version 300 es
      out vec2 uv; void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`,
      ],
      [
        gl.FRAGMENT_SHADER,
        `#version 300 es
      precision highp float; uniform sampler2D colorMap; uniform sampler2D normalMap; uniform vec3 light; uniform bool mapped; uniform vec2 fit;
      in vec2 uv; out vec4 pixel;
      void main(){vec2 p=(vec2(uv.x,1.-uv.y)-.5)/fit+.5;if(any(lessThan(p,vec2(0)))||any(greaterThan(p,vec2(1)))){pixel=vec4(0);return;}
      vec4 c=texture(colorMap,p);vec3 n=mapped?normalize(texture(normalMap,p).xyz*2.-1.):vec3(0,0,1);
      float diffuse=max(dot(n,normalize(vec3(light.xy-vec2(p.x-.5,.5-p.y),light.z))),0.);pixel=vec4(pow(pow(c.rgb,vec3(2.2))*(.12+diffuse*.88),vec3(1./2.2)),c.a);}`,
      ],
    ] as const) {
      const shader = gl.createShader(kind)!;
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error("Lighting preview shader failed");
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error("Lighting preview linking failed");
    gl.useProgram(program);
    for (const [i, image] of [color, normal].entries()) {
      const texture = gl.createTexture()!;
      textures.push(texture);
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        image,
      );
      gl.uniform1i(
        gl.getUniformLocation(program, i ? "normalMap" : "colorMap"),
        i,
      );
    }
    gl.uniform2f(
      gl.getUniformLocation(program, "fit"),
      Math.min(1, color.width / color.height),
      Math.min(1, color.height / color.width),
    );
    const lightLocation = gl.getUniformLocation(program, "light"),
      mappedLocation = gl.getUniformLocation(program, "mapped");
    function draw(time: number) {
      if (disposed) return;
      gl!.uniform3f(
        lightLocation,
        moving ? Math.cos(time / 700) * 0.9 : 0.8,
        moving ? Math.sin(time / 700) * 0.9 : -0.6,
        0.6,
      );
      for (let i = 0; i < 2; i++) {
        gl!.viewport(i * 192, 0, 192, 192);
        gl!.uniform1i(mappedLocation, i);
        gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      }
      if (moving && root.checkVisibility()) frame = requestAnimationFrame(draw);
    }
    draw(0);
    return {
      setMoving(value: boolean) {
        moving = value;
        cancelAnimationFrame(frame);
        draw(performance.now());
      },
      destroy: cleanup,
    };
  } catch (error) {
    cleanup();
    root.replaceChildren();
    throw error;
  } finally {
    color.close();
    normal.close();
  }
}
