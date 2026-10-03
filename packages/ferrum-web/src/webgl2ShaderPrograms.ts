import { WEBGL2_SHADER_SOURCES } from "./webgl2ShaderSources";
import type { WebGL2ShaderName } from "./webgl2ShaderSources";
import type { ShaderPreparationOptions, ShaderPreparationProgress } from "./shaderPreparation";

interface PendingProgram {
  name: WebGL2ShaderName;
  program: WebGLProgram;
  shaders: WebGLShader[];
}

// Installed only during the synchronous constructor call after preparation completes.
// Entries transfer once to the owning batch; no global/context cache survives construction.
const preparedPrograms = new WeakMap<WebGL2RenderingContext, Map<WebGL2ShaderName, WebGLProgram>>();

export function createWebGL2Program(gl: WebGL2RenderingContext, name: WebGL2ShaderName): WebGLProgram {
  const prepared = preparedPrograms.get(gl);
  const cached = prepared?.get(name);
  if (cached) { prepared!.delete(name); return cached; }
  const pending = submitProgram(gl, name);
  try {
    validateProgram(gl, pending);
    return pending.program;
  } catch (error) {
    gl.deleteProgram(pending.program);
    throw error;
  } finally { for (const shader of pending.shaders) gl.deleteShader(shader); }
}

export async function prepareWebGL2Renderer<T extends { destroy(): void }>(
  gl: WebGL2RenderingContext,
  options: ShaderPreparationOptions,
  construct: () => T,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    throw new Error("shaderPreparation.timeoutMs must be in (0, 120000].");
  }
  const started = performance.now();
  const signal = options.signal;
  const assertActive = () => {
    if (signal?.aborted) throw abortError();
    if (gl.isContextLost()) throw new Error("WebGL2 context lost during shader preparation.");
    if (performance.now() - started >= timeoutMs) throw new Error("WebGL2 shader preparation timed out.");
  };
  assertActive();
  const extension = gl.getExtension("KHR_parallel_shader_compile");
  const names = Object.keys(WEBGL2_SHADER_SOURCES) as WebGL2ShaderName[];
  const pending: PendingProgram[] = [];
  const ready = new Map<WebGL2ShaderName, WebGLProgram>();
  let renderer: T | undefined;
  let transferred = false;
  const report = (phase: ShaderPreparationProgress["phase"]) => options.onProgress?.({
    phase, completedPrograms: ready.size, totalPrograms: names.length,
    parallelCompile: extension !== null, elapsedMs: performance.now() - started,
  });
  try {
    report("compiling");
    // Let the caller's loading UI and cancellation run before issuing compile/link work.
    await nextTurn(signal, 0);
    assertActive();
    for (const name of names) pending.push(submitProgram(gl, name));
    while (ready.size < names.length) {
      await nextTurn(signal, extension ? 8 : 0);
      assertActive();
      for (const program of pending) {
        if (ready.has(program.name)) continue;
        if (extension && !gl.getProgramParameter(program.program, extension.COMPLETION_STATUS_KHR)) continue;
        validateProgram(gl, program);
        ready.set(program.name, program.program);
        // Without the extension a status query may block; yield between programs.
        if (!extension) break;
      }
      report("compiling");
    }
    assertActive();
    // Capture the final count before constructors consume the map.
    preparedPrograms.set(gl, new Map(ready));
    transferred = true;
    renderer = construct();
    assertActive();
    report("ready");
    assertActive();
    return renderer;
  } catch (error) {
    renderer?.destroy();
    throw error;
  } finally {
    const unused = preparedPrograms.get(gl);
    if (transferred) {
      preparedPrograms.delete(gl);
      for (const program of unused?.values() ?? []) gl.deleteProgram(program);
    } else {
      for (const program of pending) gl.deleteProgram(program.program);
    }
    for (const program of pending) for (const shader of program.shaders) gl.deleteShader(shader);
  }
}

function submitProgram(gl: WebGL2RenderingContext, name: WebGL2ShaderName): PendingProgram {
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  try {
    const source = WEBGL2_SHADER_SOURCES[name];
    for (const [type, text] of [[gl.VERTEX_SHADER, source.vertex], [gl.FRAGMENT_SHADER, source.fragment]] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error(`${name}: shader allocation failed.`);
      shaders.push(shader);
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
    }
    program = gl.createProgram();
    if (!program) throw new Error(`${name}: program allocation failed.`);
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.linkProgram(program);
    return { name, program, shaders };
  } catch (error) {
    if (program) gl.deleteProgram(program);
    for (const shader of shaders) gl.deleteShader(shader);
    throw error;
  }
}

function validateProgram(gl: WebGL2RenderingContext, pending: PendingProgram): void {
  if (gl.getProgramParameter(pending.program, gl.LINK_STATUS)) return;
  const detail = [gl.getProgramInfoLog(pending.program), ...pending.shaders.map((shader) => gl.getShaderInfoLog(shader))]
    .filter(Boolean).join("\n");
  throw new Error(`${pending.name}: shader compile/link failed. ${detail}`);
}

function abortError(): DOMException {
  return new DOMException("Shader preparation was cancelled.", "AbortError");
}

function nextTurn(signal: AbortSignal | undefined, delay: number): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, delay);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
