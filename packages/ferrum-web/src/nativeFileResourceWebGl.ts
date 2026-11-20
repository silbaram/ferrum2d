/** @internal Cold GPU readback. Restores caller bindings/pixel-pack state and
 * deletes every temporary object. No source URL or trusted pixel cache is used. */
import { ResourceBudget, resourceInteger } from "./nativeFileResourceBudget.js";
export function readFileWebGlTexture(gl: WebGL2RenderingContext, texture: WebGLTexture, width: number, height: number, compressed: boolean, srgb: boolean, b: ResourceBudget): Uint8Array {
    resourceInteger(width, "texture width", 1, 2147483647);
    resourceInteger(height, "texture height", 1, 2147483647);
    const bytes = width * height * 4;
    b.charge("decodedBytes", bytes);
    b.work(bytes);
    if (gl.isContextLost())
        b.fail("GPU", "context lost");
    // WebGL native query enums determine these binding return types.
    const previous = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const pack = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) as WebGLBuffer | null;
    const params = [gl.PACK_ALIGNMENT, gl.PACK_ROW_LENGTH, gl.PACK_SKIP_ROWS, gl.PACK_SKIP_PIXELS];
    const values = params.map(p => gl.getParameter(p) as number);
    const fb = gl.createFramebuffer();
    if (!fb)
        b.fail("ALLOCATION", "read framebuffer");
    let output: Uint8Array;
    try {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        params.forEach(p => gl.pixelStorei(p, p === gl.PACK_ALIGNMENT ? 1 : 0));
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        if (gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            if (!compressed)
                return b.fail("CAPABILITY", "external texture storage requires host binding");
            // Compressed textures cannot be attached; sample texels into RGBA8. This
            // preserves current observable decoded data, not unreadable block identity.
            return readCompressed(gl, texture, width, height, srgb, b);
        }
        output = new Uint8Array(bytes);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, output);
        if (gl.getError() !== gl.NO_ERROR || gl.isContextLost())
            b.fail("GPU", "texture readback");
        return output;
    }
    finally {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pack);
        params.forEach((p, i) => gl.pixelStorei(p, values[i]));
        gl.deleteFramebuffer(fb);
    }
}
function readCompressed(gl: WebGL2RenderingContext, texture: WebGLTexture, width: number, height: number, srgb: boolean, b: ResourceBudget): Uint8Array {
    b.charge("gpuBytes", width * height * 4);
    b.work(width * height + 32);
    const programBefore = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    const vaoBefore = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
    const readBefore = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const drawBefore = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const activeBefore = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    const mask = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];
    const caps = [gl.BLEND, gl.DEPTH_TEST, gl.STENCIL_TEST, gl.CULL_FACE, gl.SCISSOR_TEST, gl.RASTERIZER_DISCARD, gl.DITHER];
    const enabled = caps.map(c => gl.isEnabled(c));
    gl.activeTexture(gl.TEXTURE0);
    const textureBefore = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    const samplerBefore = gl.getParameter(gl.SAMPLER_BINDING) as WebGLSampler | null;
    const unpackBefore = gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING) as WebGLBuffer | null;
    const shaders: WebGLShader[] = [];
    let program: WebGLProgram | null = null, vao: WebGLVertexArrayObject | null = null;
    let target: WebGLTexture | null = null, framebuffer: WebGLFramebuffer | null = null;
    try {
        program = gl.createProgram();
        vao = gl.createVertexArray();
        target = gl.createTexture();
        framebuffer = gl.createFramebuffer();
        if (!program || !vao || !target || !framebuffer)
            return b.fail("ALLOCATION", "compressed readback objects");
        const codes = [
            `#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}`,
            `#version 300 es\nprecision highp float;uniform sampler2D image;uniform bool encode;out vec4 outColor;void main(){vec4 c=texelFetch(image,ivec2(gl_FragCoord.xy),0);if(encode)c.rgb=mix(12.92*c.rgb,1.055*pow(max(c.rgb,vec3(0)),vec3(1.0/2.4))-0.055,greaterThan(c.rgb,vec3(0.0031308)));outColor=c;}`,
        ];
        for (let i = 0; i < codes.length; i++) {
            const shader = gl.createShader(i === 0 ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER);
            if (!shader)
                return b.fail("ALLOCATION", "compressed readback shader");
            shaders.push(shader);
            gl.shaderSource(shader, codes[i]);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
                return b.fail("GPU", "compressed readback compile");
            gl.attachShader(program, shader);
        }
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
            return b.fail("GPU", "compressed readback link");
        gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, target);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
            return b.fail("GPU", "compressed readback target");
        caps.forEach(c => gl.disable(c));
        gl.colorMask(true, true, true, true);
        gl.viewport(0, 0, width, height);
        gl.useProgram(program);
        gl.bindVertexArray(vao);
        gl.bindSampler(0, null);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(gl.getUniformLocation(program, "image"), 0);
        gl.uniform1i(gl.getUniformLocation(program, "encode"), srgb ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const result = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, result);
        if (gl.getError() !== gl.NO_ERROR || gl.isContextLost())
            return b.fail("GPU", "compressed readback pixels");
        return result;
    }
    finally {
        gl.bindTexture(gl.TEXTURE_2D, textureBefore);
        gl.bindSampler(0, samplerBefore);
        gl.activeTexture(activeBefore);
        gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, unpackBefore);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readBefore);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawBefore);
        gl.useProgram(programBefore);
        gl.bindVertexArray(vaoBefore);
        gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
        gl.colorMask(mask[0], mask[1], mask[2], mask[3]);
        caps.forEach((c, i) => enabled[i] ? gl.enable(c) : gl.disable(c));
        for (const shader of shaders)
            gl.deleteShader(shader);
        if (program)
            gl.deleteProgram(program);
        if (vao)
            gl.deleteVertexArray(vao);
        if (target)
            gl.deleteTexture(target);
        if (framebuffer)
            gl.deleteFramebuffer(framebuffer);
    }
}
