/** Bounded external PNG conversion. Independent of the editor, DOM and project state. */
export const PIXEL_IMPORT_LIMITS = { bytes: 16 * 1024 * 1024, side: 4096, pixels: 4194304, outputSide: 256 } as const;
export interface PixelImportImage {
    width: number;
    height: number;
    pixels: Uint8Array;
}
export interface PixelImportCrop {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface PixelImportSettings {
    crop: PixelImportCrop;
    width: number;
    height: number;
    sampling: "nearest" | "area";
    colors: {
        mode: "original";
    } | {
        mode: "auto";
        count: number;
    } | {
        mode: "palette";
        palette: readonly string[];
    };
}
function integer(n: number, min: number, max: number) { return Number.isInteger(n) && n >= min && n <= max; }
export function pixelImportDimensions(width: number, height: number) {
    if (!integer(width, 1, PIXEL_IMPORT_LIMITS.side) || !integer(height, 1, PIXEL_IMPORT_LIMITS.side) || width * height > PIXEL_IMPORT_LIMITS.pixels)
        throw Error("Import PNG must fit 4096 pixels per side and 4 megapixels");
}
/** Check allocation bounds and reject animation before asking the browser to decode. */
export function inspectPixelImportPng(bytes: Uint8Array) {
    if (bytes.byteLength > PIXEL_IMPORT_LIMITS.bytes)
        throw Error("Import PNG exceeds 16 MiB");
    if (bytes.length < 45 || [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82].some((n, i) => bytes[i] !== n))
        throw Error("Choose a valid PNG");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16), height = view.getUint32(20);
    pixelImportDimensions(width, height);
    let offset = 8, data = false, ended = false;
    while (offset + 12 <= bytes.length) {
        const length = view.getUint32(offset);
        if (length > bytes.length - offset - 12)
            throw Error("Choose a valid PNG");
        const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
        if (kind === "acTL" || kind === "fcTL" || kind === "fdAT")
            throw Error("Animated PNG import is not supported");
        if (kind === "IHDR" && offset !== 8)
            throw Error("Choose a valid PNG");
        if (kind === "IDAT")
            data = true;
        offset += length + 12;
        if (kind === "IEND") {
            ended = length === 0;
            break;
        }
    }
    if (!ended || !data || offset !== bytes.length)
        throw Error("Choose a valid PNG");
    return { width, height };
}
export function fitPixelImportSize(width: number, height: number, side: number) {
    pixelImportDimensions(width, height);
    if (!integer(side, 1, PIXEL_IMPORT_LIMITS.outputSide))
        throw Error("Import output must be 1 to 256 pixels");
    const ratio = side / Math.max(width, height);
    return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}
type RGB = readonly [
    number,
    number,
    number
];
function selectedPalette(input: readonly string[]): RGB[] {
    if (!input.length || input.length > 256 || input.some(c => !/^#[\da-f]{8}$/i.test(c)))
        throw Error("Choose a palette with visible colors");
    const colors = input.filter(c => parseInt(c.slice(7, 9), 16) > 0).map(c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)) as [
        number,
        number,
        number
    ]);
    if (!colors.length)
        throw Error("Choose a palette with visible colors");
    return colors;
}
type Bin = {
    rgb: RGB;
    weight: number;
};
/** Weighted median cut over a bounded RGB histogram; stable ties make previews reproducible. */
function autoPalette(pixels: Uint8Array, count: number): RGB[] {
    const exact = new Map<number, Bin>();
    for (let i = 0; i < pixels.length; i += 4) {
        if (!pixels[i + 3])
            continue;
        const key = pixels[i] * 65536 + pixels[i + 1] * 256 + pixels[i + 2];
        const found = exact.get(key);
        if (found)
            found.weight += pixels[i + 3];
        else
            exact.set(key, { rgb: [pixels[i], pixels[i + 1], pixels[i + 2]], weight: pixels[i + 3] });
    }
    if (exact.size <= count)
        return [...exact.values()].map(b => b.rgb);
    const histogram = new Map<number, {
        sum: number[];
        weight: number;
    }>();
    for (const { rgb, weight } of exact.values()) {
        const key = (rgb[0] >> 3) * 1024 + (rgb[1] >> 3) * 32 + (rgb[2] >> 3), bin = histogram.get(key) ?? { sum: [0, 0, 0], weight: 0 };
        for (let c = 0; c < 3; c++)
            bin.sum[c] += rgb[c] * weight;
        bin.weight += weight;
        histogram.set(key, bin);
    }
    const describe = (bins: Bin[]) => {
        const ranges = [0, 1, 2].map(c => { let min = 255, max = 0; for (const b of bins) {
            min = Math.min(min, b.rgb[c]);
            max = Math.max(max, b.rgb[c]);
        } return max - min; });
        const channel = ranges.indexOf(Math.max(...ranges));
        return { bins, channel, range: ranges[channel], weight: bins.reduce((n, b) => n + b.weight, 0) };
    };
    const boxes = [describe([...histogram.values()].map(b => ({ rgb: b.sum.map(n => Math.round(n / b.weight)) as [
                number,
                number,
                number
            ], weight: b.weight })))];
    while (boxes.length < count) {
        let index = -1, score = -1;
        for (let i = 0; i < boxes.length; i++) {
            const b = boxes[i], next = b.range * Math.sqrt(b.weight);
            if (b.bins.length > 1 && next > score) {
                index = i;
                score = next;
            }
        }
        if (index < 0)
            break;
        const box = boxes[index], bins = box.bins.slice().sort((a, b) => a.rgb[box.channel] - b.rgb[box.channel] || a.rgb[0] - b.rgb[0] || a.rgb[1] - b.rgb[1] || a.rgb[2] - b.rgb[2]);
        let weight = 0, split = 1;
        for (; split < bins.length; split++) {
            weight += bins[split - 1].weight;
            if (weight >= box.weight / 2)
                break;
        }
        split = Math.min(split, bins.length - 1);
        boxes.splice(index, 1, describe(bins.slice(0, split)), describe(bins.slice(split)));
    }
    return boxes.map(b => [0, 1, 2].map(c => Math.round(b.bins.reduce((sum, p) => sum + p.rgb[c] * p.weight, 0) / b.weight)) as [
        number,
        number,
        number
    ]);
}
export function convertPixelImport(image: PixelImportImage, settings: PixelImportSettings): PixelImportImage & {
    palette: string[];
    colorCount: number;
} {
    pixelImportDimensions(image.width, image.height);
    if (!(image.pixels instanceof Uint8Array) || image.pixels.length !== image.width * image.height * 4)
        throw Error("Import pixel data differs from dimensions");
    const { crop, width, height, sampling, colors } = settings;
    if (!integer(crop.x, 0, image.width - 1) || !integer(crop.y, 0, image.height - 1) || !integer(crop.width, 1, image.width - crop.x) || !integer(crop.height, 1, image.height - crop.y))
        throw Error("Crop must stay inside the source image");
    if (!integer(width, 1, 256) || !integer(height, 1, 256))
        throw Error("Import output must be 1 to 256 pixels");
    if (sampling !== "nearest" && sampling !== "area")
        throw Error("Invalid import sampling");
    if (colors.mode !== "original" && colors.mode !== "auto" && colors.mode !== "palette")
        throw Error("Invalid import color mode");
    if (colors.mode === "auto" && !integer(colors.count, 2, 256))
        throw Error("Import color limit must be 2 to 256");
    let palette: RGB[] | undefined = colors.mode === "palette" ? selectedPalette(colors.palette) : undefined;
    const pixels = new Uint8Array(width * height * 4), source = image.pixels;
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const target = (y * width + x) * 4;
            if (sampling === "nearest") {
                const sx = crop.x + Math.min(crop.width - 1, Math.floor((x + .5) * crop.width / width)), sy = crop.y + Math.min(crop.height - 1, Math.floor((y + .5) * crop.height / height));
                pixels.set(source.subarray((sy * image.width + sx) * 4, (sy * image.width + sx) * 4 + 4), target);
            }
            else {
                const left = crop.x + x * crop.width / width, right = crop.x + (x + 1) * crop.width / width, top = crop.y + y * crop.height / height, bottom = crop.y + (y + 1) * crop.height / height;
                let area = 0, alpha = 0, r = 0, g = 0, b = 0;
                for (let sy = Math.floor(top); sy < Math.ceil(bottom); sy++)
                    for (let sx = Math.floor(left); sx < Math.ceil(right); sx++) {
                        const w = (Math.min(sx + 1, right) - Math.max(sx, left)) * (Math.min(sy + 1, bottom) - Math.max(sy, top)), i = (sy * image.width + sx) * 4, a = source[i + 3] * w;
                        area += w;
                        alpha += a;
                        r += source[i] * a;
                        g += source[i + 1] * a;
                        b += source[i + 2] * a;
                    }
                pixels[target + 3] = Math.round(alpha / area);
                if (alpha > 0) {
                    pixels[target] = Math.round(r / alpha);
                    pixels[target + 1] = Math.round(g / alpha);
                    pixels[target + 2] = Math.round(b / alpha);
                }
            }
        }
    if (colors.mode === "auto")
        palette = autoPalette(pixels, colors.count);
    const unique = new Set<number>();
    for (let i = 0; i < pixels.length; i += 4) {
        if (!pixels[i + 3])
            continue;
        if (palette?.length) {
            let distance = Infinity, chosen = palette[0];
            for (const c of palette) {
                const d = (c[0] - pixels[i]) ** 2 + (c[1] - pixels[i + 1]) ** 2 + (c[2] - pixels[i + 2]) ** 2;
                if (d < distance) {
                    distance = d;
                    chosen = c;
                }
            }
            pixels.set(chosen, i);
        }
        unique.add(pixels[i] * 65536 + pixels[i + 1] * 256 + pixels[i + 2]);
    }
    const hex = (rgb: RGB) => "#" + rgb.map(c => c.toString(16).padStart(2, "0")).join("") + "ff";
    const swatches = palette?.map(hex) ?? [...unique].slice(0, 256).map(n => hex([n >> 16, (n >> 8) & 255, n & 255]));
    return { width, height, pixels, palette: swatches, colorCount: unique.size };
}
