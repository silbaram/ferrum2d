import { convertPixelImport, fitPixelImportSize, inspectPixelImportPng, PIXEL_IMPORT_LIMITS, type PixelImportImage, type PixelImportSettings } from "./placementPixelImport";
import { registerUiRoot, setUiAttribute, setUiText, uiMessage } from "./placementLocale";
/** Owns only the import preview. Applying a new editor document belongs to the host. */
export function createPixelImportDialog(options: {
    key(): string;
    disabled(): boolean;
    palette(): readonly string[];
    apply(image: ReturnType<typeof convertPixelImport>, name: string, current: () => boolean): Promise<boolean>;
}) {
    let dialog: HTMLDialogElement | undefined, serial = 0, disposed = false, key = "", frame = 0;
    let image: PixelImportImage | undefined, result: ReturnType<typeof convertPixelImport> | undefined;
    let canvases: HTMLCanvasElement[] = [];
    const cancel = () => {
        serial++;
        cancelAnimationFrame(frame);
        frame = 0;
        dialog?.close();
        dialog?.remove();
        dialog = undefined;
        for (const canvas of canvases)
            canvas.width = canvas.height = 0;
        canvases = [];
        image = result = undefined;
    };
    function sync() { if (dialog && (options.disabled() || options.key() !== key))
        cancel(); }
    function open(file: File) {
        if (disposed || options.disabled())
            return;
        cancel();
        key = options.key();
        const token = serial;
        const current = () => !disposed && token === serial && options.key() === key && !options.disabled();
        const popup = document.createElement("dialog");
        dialog = popup;
        popup.className = "placement-pixel-dialog placement-pixel-import-dialog";
        popup.dataset.pixelImportDialog = "true";
        // Native modal inertness does not stop window shortcut listeners.
        popup.addEventListener("keydown", event => event.stopPropagation());
        setUiAttribute(popup, "aria-label", "Import Image");
        const title = document.createElement("h3");
        setUiText(title, "Import Image");
        popup.append(title);
        const hint = document.createElement("p");
        setUiText(hint, "Crop a PNG, choose its pixel size and colors, then open it as a new sprite.");
        popup.append(hint);
        const name = document.createElement("p");
        name.className = "placement-pixel-import-filename";
        name.textContent = file.name;
        popup.append(name);
        const columns = document.createElement("div");
        columns.className = "placement-pixel-import-columns";
        popup.append(columns);
        const sourcePanel = document.createElement("section"), outputPanel = document.createElement("section"), controls = document.createElement("fieldset");
        controls.disabled = true;
        columns.append(sourcePanel, outputPanel, controls);
        function label(parent: HTMLElement, text: string, control: HTMLElement) { const row = document.createElement("label"), caption = document.createElement("span"); setUiText(caption, text); setUiAttribute(control, "aria-label", text); row.append(caption, control); parent.append(row); }
        function caption(parent: HTMLElement, text: string) { const el = document.createElement("h4"); setUiText(el, text); parent.append(el); }
        function button(parent: HTMLElement, text: string, action: string) { const el = document.createElement("button"); el.type = "button"; el.dataset.pixelImportAction = action; setUiText(el, text); parent.append(el); return el; }
        function numeric(parent: HTMLElement, text: string, field: string, value: number, max: number) { const input = document.createElement("input"); input.type = "number"; input.min = field === "x" || field === "y" ? "0" : "1"; input.max = String(max); input.step = "1"; input.value = String(value); input.dataset.pixelImportField = field; label(parent, text, input); return input; }
        function select(text: string, field: string, choices: readonly (readonly [
            string,
            string
        ])[]) { const input = document.createElement("select"); input.dataset.pixelImportField = field; for (const [value, text] of choices) {
            const option = document.createElement("option");
            option.value = value;
            setUiText(option, text);
            input.append(option);
        } label(controls, text, input); return input; }
        caption(sourcePanel, "Source · Drag To Crop");
        caption(outputPanel, "Pixel Preview");
        const source = document.createElement("canvas"), output = document.createElement("canvas"), base = document.createElement("canvas");
        canvases = [source, output, base];
        source.dataset.pixelImportSource = "true";
        output.dataset.pixelImportPreview = "true";
        setUiAttribute(source, "aria-label", "Source · Drag To Crop");
        setUiAttribute(output, "aria-label", "Pixel Preview");
        const sourceWell = document.createElement("div"), outputWell = document.createElement("div");
        sourceWell.className = outputWell.className = "placement-pixel-import-well";
        sourceWell.append(source);
        outputWell.append(output);
        sourcePanel.append(sourceWell);
        outputPanel.append(outputWell);
        source.width = source.height = output.width = output.height = 1;
        const sourceInfo = document.createElement("p"), outputInfo = document.createElement("p");
        sourcePanel.append(sourceInfo);
        outputPanel.append(outputInfo);
        const cropControls = document.createElement("div");
        cropControls.className = "placement-pixel-import-crop";
        controls.append(cropControls);
        const x = numeric(cropControls, "Crop X", "x", 0, 4095), y = numeric(cropControls, "Crop Y", "y", 0, 4095);
        const cropWidth = numeric(cropControls, "Crop Width", "crop-width", 1, 4096), cropHeight = numeric(cropControls, "Crop Height", "crop-height", 1, 4096);
        const reset = button(controls, "Reset Crop", "reset");
        const preset = select("Longest Side", "preset", [["32", "32 px"], ["64", "64 px"], ["128", "128 px"], ["256", "256 px"], ["custom", "Custom"]]);
        preset.value = "64";
        const width = numeric(controls, "Output Width", "width", 64, 256), height = numeric(controls, "Output Height", "height", 64, 256);
        const aspect = document.createElement("input");
        aspect.type = "checkbox";
        aspect.checked = true;
        aspect.dataset.pixelImportField = "aspect";
        label(controls, "Keep Aspect Ratio", aspect);
        const sampling = select("Sampling", "sampling", [["area", "Area Average"], ["nearest", "Nearest Pixel"]]);
        const colorMode = select("Colors", "colors", [["original", "Keep Source Colors"], ["auto", "Limit Colors"], ["palette", "Current Document Palette"]]);
        const palette = [...options.palette()];
        colorMode.options[2].disabled = !palette.some(c => /^#[\da-f]{8}$/i.test(c) && parseInt(c.slice(7), 16) > 0);
        const count = select("RGB Color Limit", "count", [["8", "8"], ["16", "16"], ["32", "32"], ["64", "64"], ["128", "128"], ["256", "256"]]);
        count.value = "16";
        count.disabled = true;
        const note = document.createElement("p");
        setUiText(note, "Alpha is preserved. Color limits count RGB colors. This creates one layer and one frame; it does not remove backgrounds.");
        popup.append(note);
        const error = document.createElement("output");
        error.setAttribute("role", "status");
        error.dataset.pixelImportStatus = "true";
        setUiText(error, "Loading image…");
        popup.append(error);
        const footer = document.createElement("div");
        footer.className = "placement-pixel-import-footer";
        popup.append(footer);
        const apply = button(footer, "Open In Editor", "apply"), dismiss = button(footer, "Cancel", "cancel");
        apply.disabled = true;
        dismiss.onclick = () => { if (current()) cancel(); };
        popup.addEventListener("cancel", event => { event.preventDefault(); if (current()) cancel(); });
        const crop = () => ({ x: x.valueAsNumber, y: y.valueAsNumber, width: cropWidth.valueAsNumber, height: cropHeight.valueAsNumber });
        const settings = (): PixelImportSettings => ({ crop: crop(), width: width.valueAsNumber, height: height.valueAsNumber, sampling: sampling.value as PixelImportSettings["sampling"], colors: colorMode.value === "palette" ? { mode: "palette", palette } : colorMode.value === "auto" ? { mode: "auto", count: Number(count.value) } : { mode: "original" } });
        function drawSource() {
            if (!current() || !image)
                return;
            const context = source.getContext("2d");
            if (!context)
                return;
            context.clearRect(0, 0, source.width, source.height);
            context.drawImage(base, 0, 0);
            const c = crop(), sx = source.width / image.width, sy = source.height / image.height;
            if (![c.x, c.y, c.width, c.height].every(Number.isFinite))
                return;
            context.fillStyle = getComputedStyle(popup).getPropertyValue("--bg-0").trim();
            context.globalAlpha = .65;
            context.fillRect(0, 0, source.width, c.y * sy);
            context.fillRect(0, (c.y + c.height) * sy, source.width, source.height - (c.y + c.height) * sy);
            context.fillRect(0, c.y * sy, c.x * sx, c.height * sy);
            context.fillRect((c.x + c.width) * sx, c.y * sy, source.width - (c.x + c.width) * sx, c.height * sy);
            context.globalAlpha = 1;
            context.strokeStyle = getComputedStyle(popup).getPropertyValue("--accent").trim();
            context.lineWidth = 2;
            context.strokeRect(c.x * sx, c.y * sy, c.width * sx, c.height * sy);
        }
        function update() {
            frame = 0;
            if (!current() || !image || drag)
                return;
            try {
                result = convertPixelImport(image, settings());
                output.width = result.width;
                output.height = result.height;
                const context = output.getContext("2d");
                if (!context)
                    throw Error("Canvas image processing unavailable");
                context.putImageData(new ImageData(new Uint8ClampedArray(result.pixels), result.width, result.height), 0, 0);
                const zoom = Math.max(1, Math.floor(256 / Math.max(result.width, result.height)));
                output.style.width = result.width * zoom + "px";
                output.style.height = "auto";
                setUiText(outputInfo, uiMessage("{0} × {1} · {2} RGB colors", result.width, result.height, result.colorCount));
                setUiText(error, "");
                apply.disabled = false;
                drawSource();
            }
            catch (value) {
                result = undefined;
                output.width = output.height = 1;
                setUiText(outputInfo, "");
                setUiText(error, value instanceof Error ? value.message : String(value));
                apply.disabled = true;
            }
        }
        function queue() {
            if (!current())
                return;
            result = undefined;
            apply.disabled = true;
            count.disabled = colorMode.value !== "auto";
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(update);
        }
        function fit() {
            if (!current())
                return;
            const c = crop();
            if (!Number.isInteger(c.width) || !Number.isInteger(c.height) || c.width < 1 || c.height < 1 || c.width > 4096 || c.height > 4096 || c.width * c.height > PIXEL_IMPORT_LIMITS.pixels)
                return;
            const side = preset.value === "custom" ? Math.max(width.valueAsNumber, height.valueAsNumber) : Number(preset.value);
            if (!Number.isInteger(side) || side < 1 || side > 256)
                return;
            if (aspect.checked) {
                const size = fitPixelImportSize(c.width, c.height, side);
                width.value = String(size.width);
                height.value = String(size.height);
            }
            else if (preset.value !== "custom")
                width.value = height.value = String(side);
        }
        for (const input of [x, y, cropWidth, cropHeight])
            input.oninput = () => { if (aspect.checked)
                fit(); drawSource(); queue(); };
        preset.onchange = aspect.onchange = () => { fit(); queue(); };
        for (const input of [width, height])
            input.oninput = () => {
                preset.value = "custom";
                const c = crop(), n = input.valueAsNumber;
                if (aspect.checked && Number.isInteger(n) && n >= 1 && n <= 256 && c.width > 0 && c.height > 0) {
                    const other = input === width ? height : width, ratio = input === width ? c.height / c.width : c.width / c.height;
                    other.value = String(Math.max(1, Math.round(n * ratio)));
                }
                queue();
            };
        sampling.onchange = colorMode.onchange = count.onchange = queue;
        reset.onclick = () => { if (!current() || !image)
            return; x.value = y.value = "0"; cropWidth.value = String(image.width); cropHeight.value = String(image.height); fit(); drawSource(); queue(); };
        let drag: {
            id: number;
            x: number;
            y: number;
        } | undefined;
        function point(event: PointerEvent) { const rect = source.getBoundingClientRect(); return { x: Math.max(0, Math.min(image!.width - 1, Math.floor((event.clientX - rect.left) / rect.width * image!.width))), y: Math.max(0, Math.min(image!.height - 1, Math.floor((event.clientY - rect.top) / rect.height * image!.height))) }; }
        source.onpointerdown = event => {
            if (!current() || !image || drag || event.button !== 0 || controls.disabled)
                return;
            event.preventDefault();
            drag = { id: event.pointerId, ...point(event) };
            source.setPointerCapture(event.pointerId);
            // A numeric-input preview may still be queued when cropping starts.
            cancelAnimationFrame(frame);
            frame = 0;
            result = undefined;
            apply.disabled = true;
        };
        source.onpointermove = event => { if (!current() || !drag || drag.id !== event.pointerId || !image)
            return; const p = point(event); x.value = String(Math.min(drag.x, p.x)); y.value = String(Math.min(drag.y, p.y)); cropWidth.value = String(Math.abs(p.x - drag.x) + 1); cropHeight.value = String(Math.abs(p.y - drag.y) + 1); fit(); drawSource(); };
        const finish = (event: PointerEvent) => { if (drag?.id !== event.pointerId)
            return; drag = undefined; if (source.hasPointerCapture(event.pointerId))
            source.releasePointerCapture(event.pointerId); queue(); };
        source.onpointerup = source.onpointercancel = source.onlostpointercapture = finish;
        apply.onclick = async () => {
            if (!current() || !result || drag || apply.disabled)
                return;
            const value = result;
            apply.disabled = true;
            controls.disabled = true;
            try {
                if (await options.apply(value, file.name, current)) {
                    if (current())
                        cancel();
                }
            }
            catch (value) {
                if (current())
                    setUiText(error, value instanceof Error ? value.message : String(value));
            }
            finally {
                if (current()) {
                    controls.disabled = false;
                    apply.disabled = !result;
                }
            }
        };
        registerUiRoot(popup);
        document.body.append(popup);
        popup.showModal();
        dismiss.focus();
        void (async () => {
            if (file.size > PIXEL_IMPORT_LIMITS.bytes)
                throw Error("Import PNG exceeds 16 MiB");
            const bytes = new Uint8Array(await file.arrayBuffer());
            if (!current())
                return;
            const size = inspectPixelImportPng(bytes);
            if (!current())
                return;
            const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
            const canvas = document.createElement("canvas");
            try {
                if (!current())
                    return;
                if (bitmap.width !== size.width || bitmap.height !== size.height)
                    throw Error("PNG dimensions differ");
                canvas.width = size.width;
                canvas.height = size.height;
                const context = canvas.getContext("2d");
                if (!context)
                    throw Error("Canvas image processing unavailable");
                context.drawImage(bitmap, 0, 0);
                image = { ...size, pixels: new Uint8Array(context.getImageData(0, 0, size.width, size.height).data) };
                const ratio = Math.min(1, 480 / Math.max(size.width, size.height));
                source.width = base.width = Math.max(1, Math.round(size.width * ratio));
                source.height = base.height = Math.max(1, Math.round(size.height * ratio));
                base.getContext("2d")!.drawImage(canvas, 0, 0, base.width, base.height);
                cropWidth.value = String(size.width);
                cropHeight.value = String(size.height);
                x.max = String(size.width - 1);
                y.max = String(size.height - 1);
                cropWidth.max = String(size.width);
                cropHeight.max = String(size.height);
                setUiText(sourceInfo, uiMessage("{0} × {1} pixels", size.width, size.height));
                controls.disabled = false;
                fit();
                update();
            }
            finally {
                bitmap.close();
                canvas.width = canvas.height = 0;
            }
        })().catch(value => { if (current())
            setUiText(error, value instanceof Error ? value.message : String(value)); });
    }
    return { open, cancel, sync, destroy() { disposed = true; cancel(); } };
}
