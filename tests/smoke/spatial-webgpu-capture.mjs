// CI target adapter only. All shaders, buffers, depth tests and readback use real WebGPU.
// Native canvas presentation is verified separately by the default smoke command.
export function installSpatialGpuTarget() {
  const original = HTMLCanvasElement.prototype.getContext,
    contexts = new WeakMap();
  HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
    if (kind !== "webgpu" || this.dataset.spatialGpuTarget !== "true")
      return Reflect.apply(original, this, [kind, ...args]);
    let context = contexts.get(this);
    if (context) return context;
    const canvas = this;
    let texture;
    context = {
      configure({ device, format, usage }) {
        texture?.destroy();
        texture = device.createTexture({
          label: "Spatial smoke offscreen target",
          size: [canvas.width, canvas.height, 1],
          format,
          usage,
        });
      },
      getCurrentTexture() {
        if (!texture) throw Error("Spatial GPU capture not configured");
        return texture;
      },
      dispose() {
        texture?.destroy();
      },
    };
    contexts.set(canvas, context);
    return context;
  };
  window.disposeSpatialGpuTarget = (canvas) => {
    contexts.get(canvas)?.dispose();
    contexts.delete(canvas);
  };
}
