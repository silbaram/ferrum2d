export {};

declare global {
  interface Navigator {
    gpu?: GPU;
  }

  interface GPU {
    requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
    getPreferredCanvasFormat(): GPUTextureFormat;
  }

  interface GPURequestAdapterOptions {
    powerPreference?: "low-power" | "high-performance";
  }

  interface GPUAdapter {
    requestDevice(): Promise<GPUDevice>;
  }

  interface GPUDevice {
    queue: GPUQueue;
    createCommandEncoder(): GPUCommandEncoder;
  }

  interface GPUQueue {
    submit(commandBuffers: GPUCommandBuffer[]): void;
  }

  interface GPUCanvasContext {
    configure(configuration: GPUCanvasConfiguration): void;
    unconfigure?(): void;
    getCurrentTexture(): GPUTexture;
  }

  interface GPUCanvasConfiguration {
    device: GPUDevice;
    format: GPUTextureFormat;
    alphaMode?: "opaque" | "premultiplied";
  }

  type GPUTextureFormat = string;

  interface GPUTexture {
    createView(): GPUTextureView;
  }

  interface GPUTextureView {}

  interface GPUCommandEncoder {
    beginRenderPass(descriptor: GPURenderPassDescriptor): GPURenderPassEncoder;
    finish(): GPUCommandBuffer;
  }

  interface GPURenderPassEncoder {
    end(): void;
  }

  interface GPUCommandBuffer {}

  interface GPURenderPassDescriptor {
    colorAttachments: GPURenderPassColorAttachment[];
  }

  interface GPURenderPassColorAttachment {
    view: GPUTextureView;
    clearValue: GPUColor;
    loadOp: "clear" | "load";
    storeOp: "store" | "discard";
  }

  interface GPUColor {
    r: number;
    g: number;
    b: number;
    a: number;
  }
}
