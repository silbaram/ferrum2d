/** @internal Current GPU bytes, not recovery-source bytes. COPY_SRC, immutable
 * descriptor and padded transfer bounds are checked before any staging buffer. */
import "./webgpuTypes.js";
import { ResourceBudget, resourceInteger } from "./nativeFileResourceBudget.js";
export async function readFileWebGpuTexture(device: GPUDevice, texture: GPUTexture, b: ResourceBudget): Promise<Uint8Array> {
    const width = resourceInteger(texture.width, "GPU texture width", 1), height = resourceInteger(texture.height, "GPU texture height", 1);
    if (texture.format !== "rgba8unorm" || texture.depthOrArrayLayers !== 1 || texture.mipLevelCount !== 1 || texture.sampleCount !== 1
        || texture.dimension !== "2d" || !(texture.usage & GPUTextureUsage.COPY_SRC))
        return b.fail("CAPABILITY", "external GPU descriptor/usage requires binding");
    const row = Math.ceil(width * 4 / 256) * 256, padded = row * height, compact = width * height * 4;
    b.charge("gpuBytes", padded);
    b.charge("decodedBytes", padded + compact);
    b.work(padded + compact);
    let buffer: GPUBuffer | undefined;
    let mapped = false, scopeError: {
        readonly message: string;
    } | null | undefined;
    device.pushErrorScope("validation");
    device.pushErrorScope("out-of-memory");
    try {
        buffer = device.createBuffer({ label: "Native file texture readback", size: padded, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: row, rowsPerImage: height }, { width, height, depthOrArrayLayers: 1 });
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        mapped = true;
        const bytes = new Uint8Array(buffer.getMappedRange()), result = new Uint8Array(compact);
        for (let y = 0; y < height; y++)
            result.set(bytes.subarray(y * row, y * row + width * 4), y * width * 4);
        return result;
    }
    catch {
        return b.fail("GPU", "texture transfer/readback");
    }
    finally {
        if (mapped)
            buffer?.unmap();
        buffer?.destroy();
        try {
            const allocation = await device.popErrorScope(), validation = await device.popErrorScope();
            scopeError = allocation ?? validation;
        }
        catch {
            b.fail("GPU", "texture error scope/device loss");
        }
        if (scopeError)
            b.fail("GPU", "texture validation/allocation scope");
    }
}
