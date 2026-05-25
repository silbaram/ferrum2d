export {};

declare global {
  type GPUTextureFormat = string;
  type GPUCanvasAlphaMode = "opaque" | "premultiplied";
  type GPULoadOp = "load" | "clear";
  type GPUStoreOp = "store" | "discard";
  type GPUPowerPreference = "low-power" | "high-performance";
  type GPUPrimitiveTopology = "point-list" | "line-list" | "line-strip" | "triangle-list" | "triangle-strip";
  type GPUVertexStepMode = "vertex" | "instance";
  type GPUVertexFormat = "float32" | "float32x2" | "float32x3" | "float32x4";
  type FerrumWebGpuBufferSource = ArrayBufferLike | ArrayBufferView<ArrayBufferLike>;

  const GPUBufferUsage: {
    readonly MAP_READ: number;
    readonly MAP_WRITE: number;
    readonly COPY_SRC: number;
    readonly COPY_DST: number;
    readonly INDEX: number;
    readonly VERTEX: number;
    readonly UNIFORM: number;
    readonly STORAGE: number;
    readonly INDIRECT: number;
    readonly QUERY_RESOLVE: number;
  };

  const GPUTextureUsage: {
    readonly COPY_SRC: number;
    readonly COPY_DST: number;
    readonly TEXTURE_BINDING: number;
    readonly STORAGE_BINDING: number;
    readonly RENDER_ATTACHMENT: number;
  };

  const GPUShaderStage: {
    readonly VERTEX: number;
    readonly FRAGMENT: number;
    readonly COMPUTE: number;
  };

  interface Navigator {
    readonly gpu?: GPU;
  }

  interface HTMLCanvasElement {
    getContext(contextId: "webgpu"): GPUCanvasContext | null;
  }

  interface GPU {
    requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
    getPreferredCanvasFormat(): GPUTextureFormat;
  }

  interface GPURequestAdapterOptions {
    powerPreference?: GPUPowerPreference;
    forceFallbackAdapter?: boolean;
  }

  interface GPUAdapter {
    requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
  }

  interface GPUDeviceDescriptor {
    label?: string;
  }

  interface GPUDevice {
    readonly queue: GPUQueue;
    createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
    createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline;
    createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout;
    createPipelineLayout(descriptor: GPUPipelineLayoutDescriptor): GPUPipelineLayout;
    createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;
    createTexture(descriptor: GPUTextureDescriptor): GPUTexture;
    createSampler(descriptor?: GPUSamplerDescriptor): GPUSampler;
    createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup;
    createCommandEncoder(descriptor?: GPUCommandEncoderDescriptor): GPUCommandEncoder;
  }

  interface GPUCanvasContext {
    configure(configuration: GPUCanvasConfiguration): void;
    getCurrentTexture(): GPUTexture;
  }

  interface GPUCanvasConfiguration {
    device: GPUDevice;
    format: GPUTextureFormat;
    usage?: number;
    alphaMode?: GPUCanvasAlphaMode;
  }

  interface GPUQueue {
    writeBuffer(
      buffer: GPUBuffer,
      bufferOffset: number,
      data: FerrumWebGpuBufferSource,
      dataOffset?: number,
      size?: number,
    ): void;
    writeTexture(
      destination: GPUImageCopyTexture,
      data: FerrumWebGpuBufferSource,
      dataLayout: GPUImageDataLayout,
      size: GPUExtent3D,
    ): void;
    copyExternalImageToTexture(
      source: GPUImageCopyExternalImage,
      destination: GPUImageCopyTextureTagged,
      copySize: GPUExtent3D,
    ): void;
    submit(commandBuffers: GPUCommandBuffer[]): void;
  }

  interface GPUShaderModule {}

  interface GPUShaderModuleDescriptor {
    label?: string;
    code: string;
  }

  interface GPURenderPipeline {
    getBindGroupLayout(index: number): GPUBindGroupLayout;
  }

  interface GPURenderPipelineDescriptor {
    label?: string;
    layout: "auto" | GPUPipelineLayout;
    vertex: GPUVertexState;
    fragment?: GPUFragmentState;
    primitive?: GPUPrimitiveState;
  }

  interface GPUPipelineLayout {}

  interface GPUPipelineLayoutDescriptor {
    label?: string;
    bindGroupLayouts: GPUBindGroupLayout[];
  }

  interface GPUVertexState {
    module: GPUShaderModule;
    entryPoint?: string;
    buffers?: GPUVertexBufferLayout[];
  }

  interface GPUFragmentState {
    module: GPUShaderModule;
    entryPoint?: string;
    targets?: GPUColorTargetState[];
  }

  interface GPUColorTargetState {
    format: GPUTextureFormat;
    blend?: GPUBlendState;
    writeMask?: number;
  }

  interface GPUBlendState {
    color: GPUBlendComponent;
    alpha: GPUBlendComponent;
  }

  interface GPUBlendComponent {
    operation?: "add" | "subtract" | "reverse-subtract" | "min" | "max";
    srcFactor?: string;
    dstFactor?: string;
  }

  interface GPUPrimitiveState {
    topology?: GPUPrimitiveTopology;
  }

  interface GPUVertexBufferLayout {
    arrayStride: number;
    stepMode?: GPUVertexStepMode;
    attributes: GPUVertexAttribute[];
  }

  interface GPUVertexAttribute {
    shaderLocation: number;
    offset: number;
    format: GPUVertexFormat;
  }

  interface GPUBuffer {
    destroy(): void;
  }

  interface GPUBufferDescriptor {
    label?: string;
    size: number;
    usage: number;
  }

  interface GPUTexture {
    createView(descriptor?: GPUTextureViewDescriptor): GPUTextureView;
    destroy(): void;
  }

  interface GPUTextureDescriptor {
    label?: string;
    size: GPUExtent3D;
    format: GPUTextureFormat;
    usage: number;
  }

  interface GPUTextureView {}

  interface GPUTextureViewDescriptor {
    label?: string;
  }

  interface GPUSampler {}

  interface GPUSamplerDescriptor {
    label?: string;
    addressModeU?: "clamp-to-edge" | "repeat" | "mirror-repeat";
    addressModeV?: "clamp-to-edge" | "repeat" | "mirror-repeat";
    magFilter?: "nearest" | "linear";
    minFilter?: "nearest" | "linear";
  }

  interface GPUBindGroup {}

  interface GPUBindGroupLayout {}

  interface GPUBindGroupLayoutDescriptor {
    label?: string;
    entries: GPUBindGroupLayoutEntry[];
  }

  interface GPUBindGroupLayoutEntry {
    binding: number;
    visibility: number;
    buffer?: GPUBufferBindingLayout;
    sampler?: GPUSamplerBindingLayout;
    texture?: GPUTextureBindingLayout;
  }

  interface GPUBufferBindingLayout {
    type?: "uniform" | "storage" | "read-only-storage";
    hasDynamicOffset?: boolean;
    minBindingSize?: number;
  }

  interface GPUSamplerBindingLayout {
    type?: "filtering" | "non-filtering" | "comparison";
  }

  interface GPUTextureBindingLayout {
    sampleType?: "float" | "unfilterable-float" | "depth" | "sint" | "uint";
    viewDimension?: "1d" | "2d" | "2d-array" | "cube" | "cube-array" | "3d";
    multisampled?: boolean;
  }

  interface GPUBindGroupDescriptor {
    label?: string;
    layout: GPUBindGroupLayout;
    entries: GPUBindGroupEntry[];
  }

  interface GPUBindGroupEntry {
    binding: number;
    resource: GPUBindingResource;
  }

  type GPUBindingResource = GPUSampler | GPUTextureView | GPUBufferBinding;

  interface GPUBufferBinding {
    buffer: GPUBuffer;
    offset?: number;
    size?: number;
  }

  interface GPUCommandEncoder {
    beginRenderPass(descriptor: GPURenderPassDescriptor): GPURenderPassEncoder;
    finish(): GPUCommandBuffer;
  }

  interface GPUCommandEncoderDescriptor {
    label?: string;
  }

  interface GPUCommandBuffer {}

  interface GPURenderPassEncoder {
    setPipeline(pipeline: GPURenderPipeline): void;
    setBindGroup(index: number, bindGroup: GPUBindGroup): void;
    setVertexBuffer(slot: number, buffer: GPUBuffer, offset?: number, size?: number): void;
    draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number): void;
    end(): void;
  }

  interface GPURenderPassDescriptor {
    label?: string;
    colorAttachments: GPURenderPassColorAttachment[];
  }

  interface GPURenderPassColorAttachment {
    view: GPUTextureView;
    loadOp: GPULoadOp;
    storeOp: GPUStoreOp;
    clearValue?: GPUColor;
  }

  interface GPUColor {
    r: number;
    g: number;
    b: number;
    a: number;
  }

  interface GPUImageCopyTexture {
    texture: GPUTexture;
    origin?: GPUOrigin3D;
  }

  interface GPUImageCopyTextureTagged extends GPUImageCopyTexture {
    premultipliedAlpha?: boolean;
  }

  interface GPUImageCopyExternalImage {
    source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
    origin?: GPUOrigin2D;
    flipY?: boolean;
  }

  interface GPUImageDataLayout {
    offset?: number;
    bytesPerRow?: number;
    rowsPerImage?: number;
  }

  type GPUExtent3D = readonly [number, number, number] | GPUExtent3DDict;

  interface GPUExtent3DDict {
    width: number;
    height?: number;
    depthOrArrayLayers?: number;
  }

  interface GPUOrigin2D {
    x?: number;
    y?: number;
  }

  interface GPUOrigin3D extends GPUOrigin2D {
    z?: number;
  }
}
