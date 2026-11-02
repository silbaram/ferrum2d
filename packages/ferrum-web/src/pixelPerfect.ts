/** Flat 2D virtual framebuffer. Camera/sprite snapping is a separate setting. */
export interface PixelPerfectOptions {
    width: number;
    height: number;
    /** Opaque display RGB in [0,1]; defaults to black. */
    background?: readonly [
        number,
        number,
        number
    ];
}
/** Immutable, top-left physical-pixel presentation rectangle for input and overlays. */
export interface PixelPerfectPresentation {
    readonly settings: Readonly<PixelPerfectOptions>;
    readonly sourceWidth: number;
    readonly sourceHeight: number;
    readonly canvasWidth: number;
    readonly canvasHeight: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    /** Integer when the virtual image fits. Smaller canvases use nearest fit. */
    readonly scale: number;
    readonly integerScale: boolean;
}
export function resolvePixelPerfectOptions(value: unknown): PixelPerfectOptions | undefined {
    if (value === undefined || value === false)
        return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw Error("pixelPerfect must be false or an object");
    const v = value as Record<string, unknown>;
    if (Object.keys(v).some(key => !["width", "height", "background"].includes(key)))
        throw Error("Unknown pixelPerfect option");
    const valid = (n: unknown): n is number => Number.isInteger(n) && Number(n) >= 1 && Number(n) <= 2048;
    if (!valid(v.width) || !valid(v.height) || v.width * v.height > 1048576)
        throw Error("pixelPerfect dimensions must be integers in [1,2048], at most 1 megapixel");
    const background = v.background === undefined ? [0, 0, 0] : v.background;
    if (!Array.isArray(background) || background.length !== 3 || ![0, 1, 2].every(index => {
        const c = background[index];
        return typeof c === "number" && Number.isFinite(c) && c >= 0 && c <= 1;
    }))
        throw Error("pixelPerfect.background must be RGB in [0,1]");
    return Object.freeze({ width: v.width, height: v.height, background: Object.freeze([...background]) as readonly [
            number,
            number,
            number
        ] });
}
export function resolvePixelPerfectPresentation(canvasWidth: number, canvasHeight: number, options: PixelPerfectOptions): PixelPerfectPresentation {
    const settings = resolvePixelPerfectOptions(options);
    if (!settings)
        throw Error("Pixel presentation requires enabled options");
    if (!Number.isSafeInteger(canvasWidth) || !Number.isSafeInteger(canvasHeight) || canvasWidth < 1 || canvasHeight < 1)
        throw Error("Pixel presentation requires positive physical canvas dimensions");
    const fit = Math.min(canvasWidth / settings.width, canvasHeight / settings.height);
    const integerScale = fit >= 1;
    const scale = integerScale ? Math.floor(fit) : fit;
    const width = Math.max(1, Math.floor(settings.width * scale));
    const height = Math.max(1, Math.floor(settings.height * scale));
    return Object.freeze({ settings, sourceWidth: settings.width, sourceHeight: settings.height, canvasWidth, canvasHeight,
        x: Math.floor((canvasWidth - width) / 2), y: Math.floor((canvasHeight - height) / 2), width, height, scale, integerScale });
}
/** Canvas CSS coordinates to virtual pixels. Values outside the image remain outside. */
export function pixelPerfectPointToViewport(p: PixelPerfectPresentation, x: number, y: number, cssWidth: number, cssHeight: number): {
    x: number;
    y: number;
    inside: boolean;
} {
    if (![x, y, cssWidth, cssHeight].every(Number.isFinite) || cssWidth <= 0 || cssHeight <= 0)
        throw Error("Pixel pointer mapping requires finite coordinates and positive CSS dimensions");
    const px = x * p.canvasWidth / cssWidth - p.x, py = y * p.canvasHeight / cssHeight - p.y;
    return { x: px * p.sourceWidth / p.width, y: py * p.sourceHeight / p.height, inside: px >= 0 && py >= 0 && px < p.width && py < p.height };
}
