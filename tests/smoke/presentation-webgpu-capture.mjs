// Real WebGPU textures, shaders and queue submissions; no canvas swapchain is required.
// The returned capture uses GPU readback, so it also works on headless CI drivers.
export function installPresentationGpuCapture() {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
    if (kind !== "webgpu" || this.id !== "game") return Reflect.apply(original, this, [kind, ...args]);
    const canvas = this;
    let texture, device, format;
    window.gpuErrors = [];
    const context = {
      configure(config) {
        if (device !== config.device) {
          device = config.device;
          device.addEventListener("uncapturederror", (event) => window.gpuErrors.push(event.error.message));
        }
        format = config.format;
        texture?.destroy();
        texture = device.createTexture({ size: [canvas.width, canvas.height], format,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      },
      getCurrentTexture() { return texture; },
    };
    window.capturePresentationGpu = async (points) => {
      const width = canvas.width, height = canvas.height;
      const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
      const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      try {
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height]);
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        const source = new Uint8Array(buffer.getMappedRange()), rgba = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
          const src = y * bytesPerRow + x * 4, dest = (y * width + x) * 4;
          rgba[dest] = source[src + (format.startsWith("bgra") ? 2 : 0)]; rgba[dest + 1] = source[src + 1];
          rgba[dest + 2] = source[src + (format.startsWith("bgra") ? 0 : 2)]; rgba[dest + 3] = source[src + 3];
        }
        const output = document.createElement("canvas"); output.width = width; output.height = height;
        const ctx = output.getContext("2d", { willReadFrequently: true }); ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
        const pixels = Object.fromEntries(Object.entries(points).map(([key, p]) => [key,
          [...ctx.getImageData(Math.floor(p.x * width / canvas.clientWidth), Math.floor(p.y * height / canvas.clientHeight), 1, 1).data]]));
        return { pixels, png: output.toDataURL("image/png") };
      } finally { buffer.destroy(); }
    };
    window.disposePresentationGpuCapture = () => { texture.destroy(); device.destroy(); };
    return context;
  };
}
