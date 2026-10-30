import type { FerrumRuntimeFrame, SpatialPoint, SpatialPointLightSpec } from "@ferrum2d/ferrum-web/core";
import type { ScenePlacementViewer, ScenePlacementViewerState } from "@ferrum2d/ferrum-web/authoring";
import { pointOnElevationPlane, type PlaneProjection } from "./placementGridGeometry";
import { decorateViewportAction } from "./placementViewportChrome";
import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";
import { placementLightAnchor } from "./placementSpatialPose";
/** DOM authoring overlay. Never retained Wasm views or runtime simulation state. */
export function createPlacementLightGizmos(options: {
    canvas: HTMLCanvasElement;
    stage: HTMLElement;
    viewer: ScenePlacementViewer;
    enabled(): boolean;
    busy(): boolean;
    key(): string;
    selected(): number;
    hasObjectSelection(): boolean;
    select(index: number): void;
    finishEdit(): void;
    onChange(state: ScenePlacementViewerState): unknown;
}) {
    const root = document.createElement("div"), tools = document.createElement("div"), label = document.createElement("span");
    root.className = "placement-light-gizmos";
    tools.className = "placement-light-tools";
    tools.hidden = true;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"), ring = document.createElementNS(svg.namespaceURI, "polyline"), cone = document.createElementNS(svg.namespaceURI, "polyline");
    svg.append(ring, cone);
    root.append(svg, tools);
    tools.append(label);
    options.stage.append(root);
    const icons: HTMLButtonElement[] = [];
    let state = options.viewer.state();
    let selected = false, documentKey = "", projection: PlaneProjection | undefined;
    type Kind = "move" | "height" | "radius";
    let drag: {
        pointer: number;
        button: HTMLButtonElement;
        index: number;
        kind: Kind;
        start: {
            x: number;
            y: number;
        };
        world: SpatialPoint;
        light: SpatialPointLightSpec;
        projection: PlaneProjection;
    } | undefined;
    function worldPosition(state: ScenePlacementViewerState, index: number): SpatialPoint {
        const p = state.spatial!.environment!.lighting!.lights[index].position;
        const id = Object.entries(state.spatial?.lightBindings ?? {}).find(([, indices]) => indices.includes(index))?.[0] ?? (state.spatial!.environment!.lighting!.lights[index].followActor ? state.spatial?.actor?.instanceId : undefined);
        const anchor = placementLightAnchor(state, id);
        return { x: p.x + anchor.x, y: p.y + anchor.y, elevation: p.elevation + anchor.elevation };
    }
    // Authored positions change on sync, not on camera/render frames. Keep hierarchy
    // lookup out of the frame loop, especially in scenes with many objects.
    const positionsFor = (next: ScenePlacementViewerState) => (next.spatial?.environment?.lighting?.lights ?? []).map((_, i) => worldPosition(next, i));
    let positions = positionsFor(state);
    function project(point: SpatialPoint) {
        if (!projection)
            return;
        const { camera: m, rect: r } = projection;
        const w = m[3] * point.x + m[7] * point.elevation - m[11] * point.y + m[15];
        if (w <= 0)
            return;
        const x = (m[0] * point.x + m[4] * point.elevation - m[8] * point.y + m[12]) / w;
        const y = (m[1] * point.x + m[5] * point.elevation - m[9] * point.y + m[13]) / w;
        const z = (m[2] * point.x + m[6] * point.elevation - m[10] * point.y + m[14]) / w;
        if (z < -1 || z > 1)
            return;
        return { x: r.left + (x + 1) * r.width / 2, y: r.top + (1 - y) * r.height / 2 };
    }
    function apply(index: number, light: SpatialPointLightSpec) {
        const state = options.viewer.state(), environment = structuredClone(state.spatial?.environment);
        if (!environment?.lighting?.lights[index])
            return;
        environment.lighting.lights = environment.lighting.lights.map((p, i) => i === index ? light : p);
        options.onChange(options.viewer.updateSpatial([{ kind: "setEnvironment", changes: { environment } }]));
    }
    function finish(cancel: boolean) {
        const previous = drag;
        if (!previous)
            return;
        drag = undefined;
        if (previous.button.hasPointerCapture(previous.pointer))
            previous.button.releasePointerCapture(previous.pointer);
        options.onChange(cancel ? options.viewer.cancelEdit() : options.viewer.commitEdit());
    }
    function start(event: PointerEvent, index: number, kind: Kind, button: HTMLButtonElement) {
        if (event.button !== 0 || !projection || !options.enabled() || options.busy() || drag)
            return;
        event.preventDefault();
        event.stopPropagation();
        selected = true;
        options.select(index);
        const state = options.viewer.state(), light = state.spatial?.environment?.lighting?.lights[index];
        if (!light)
            return;
        options.finishEdit();
        options.viewer.beginEdit("Light Transform");
        drag = { pointer: event.pointerId, button, index, kind, start: { x: event.clientX, y: event.clientY }, world: worldPosition(state, index), light: structuredClone(light), projection: { camera: projection.camera.slice(), rect: {left:projection.rect.left,top:projection.rect.top,width:projection.rect.width,height:projection.rect.height} } };
        button.setPointerCapture(event.pointerId);
    }
    function install(button: HTMLButtonElement, index: () => number, kind: Kind) {
        button.addEventListener("pointerdown", event => start(event, index(), kind, button));
        button.addEventListener("pointermove", event => {
            const d = drag;
            if (!d || d.button !== button || event.pointerId !== d.pointer)
                return;
            event.preventDefault();
            event.stopPropagation();
            if (Math.hypot(event.clientX - d.start.x, event.clientY - d.start.y) < 2)
                return;
            const light = structuredClone(d.light), at = pointOnElevationPlane({ x: event.clientX, y: event.clientY }, d.world.elevation, d.projection);
            if (d.kind === "move") {
                const before = pointOnElevationPlane(d.start, d.world.elevation, d.projection);
                if (!at || !before)
                    return;
                light.position.x += at.x - before.x;
                light.position.y += at.y - before.y;
            }
            else if (d.kind === "radius") {
                const before = pointOnElevationPlane(d.start, d.world.elevation, d.projection);
                if (!at || !before)
                    return;
                light.radius = Math.max(.1, d.light.radius + Math.hypot(at.x - d.world.x, at.y - d.world.y) - Math.hypot(before.x - d.world.x, before.y - d.world.y));
            }
            else {
                const { camera: m, rect: r } = d.projection, v = 1 - (event.clientY - r.top) / r.height * 2;
                const cy = m[1] * d.world.x - m[9] * d.world.y + m[13], cw = m[3] * d.world.x - m[11] * d.world.y + m[15], den = m[5] - v * m[7];
                if (Math.abs(den) < 1e-9)
                    return;
                const elevation = (v * cw - cy) / den;
                if (cw + m[7] * elevation <= 0)
                    return;
                const initialV = 1 - (d.start.y - r.top) / r.height * 2, initialDen = m[5] - initialV * m[7];
                if (Math.abs(initialDen) < 1e-9)
                    return;
                light.position.elevation += elevation - (initialV * cw - cy) / initialDen;
            }
            if ([...Object.values(light.position), light.radius].some(v => !Number.isFinite(v) || Math.abs(v) > 1e6))
                return;
            try {
                apply(d.index, light);
            }
            catch (error) {
                finish(true);
                window.dispatchEvent(new CustomEvent("ferrum-placement-document-error", { detail: error }));
            }
        });
        button.addEventListener("pointerup", event => { if (drag?.pointer === event.pointerId) {
            event.stopPropagation();
            finish(false);
        } });
        button.addEventListener("pointercancel", () => finish(true));
        button.addEventListener("lostpointercapture", () => finish(true));
        button.addEventListener("keydown", event => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.code) || options.busy() || !options.enabled())
                return;
            event.preventDefault();
            event.stopPropagation();
            const i = index(), light = structuredClone(options.viewer.state().spatial?.environment?.lighting?.lights[i]);
            if (!light)
                return;
            const delta = (event.code === "ArrowLeft" || event.code === "ArrowDown" ? -1 : 1) * (event.shiftKey ? 10 : 1);
            const coordinate = (value: number) => Math.max(-1e6, Math.min(1e6, value));
            if (kind === "radius")
                light.radius = Math.max(.1, Math.min(1e6, light.radius + delta));
            else if (kind === "height")
                light.position.elevation = coordinate(light.position.elevation + delta);
            else if (event.code === "ArrowLeft" || event.code === "ArrowRight")
                light.position.x = coordinate(light.position.x + delta);
            else
                light.position.y = coordinate(light.position.y + delta);
            try { apply(i, light); }
            catch (error) { window.dispatchEvent(new CustomEvent("ferrum-placement-document-error", { detail: error })); }
        });
    }
    for (const [kind, icon, text] of [["height", "height", "Light Height"], ["radius", "fit", "Light Radius"]] as const) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.lightHandle = kind;
        decorateViewportAction(button, icon, text);
        tools.append(button);
        install(button, options.selected, kind);
    }
    options.canvas.addEventListener("pointerdown", () => { if (!drag)
        selected = false; });
    window.addEventListener("keydown", event => { if (event.code === "Escape" && drag) {
        event.preventDefault();
        event.stopImmediatePropagation();
        finish(true);
    } }, { capture: true });
    window.addEventListener("blur", () => finish(true));
    return {
        sync(next: ScenePlacementViewerState) { state = next; positions = positionsFor(next); },
        ownsGesture: () => drag !== undefined,
        select() { selected = true; },
        cancel() { finish(true); },
        frame(update: FerrumRuntimeFrame) {
            if (options.hasObjectSelection()) selected = false;
            if (documentKey !== options.key()) {
                finish(true);
                selected = false;
                documentKey = options.key();
            }
            const spatial = update.frame.renderCommandBuffer.spatial, lights = state.spatial?.environment?.lighting?.lights ?? [];
            root.hidden = !options.enabled() || !spatial || !lights.length;
            if (root.hidden) {
                if (!options.enabled()) finish(true);
                return;
            }
            const rect = options.canvas.getBoundingClientRect(), stage = options.stage.getBoundingClientRect(), p = spatial!.presentation;
            projection = { camera: spatial!.camera.slice(), rect: p && p[4] > 0 ? { left: rect.left + rect.width * p[0], top: rect.top + rect.height * p[1], width: rect.width * p[2], height: rect.height * p[3] } : rect };
            while (icons.length < lights.length) {
                const index = icons.length, button = document.createElement("button");
                button.type = "button";
                button.dataset.lightIndex = String(index);
                decorateViewportAction(button, "sun", "Move Light", undefined, true);
                root.append(button);
                icons.push(button);
                install(button, () => index, "move");
                button.addEventListener("click", () => { selected = true; options.select(index); });
            }
            while (icons.length > lights.length)
                icons.pop()!.remove();
            icons.forEach((button, i) => { const at = project(positions[i]); button.hidden = !at || at.x < rect.left || at.x > rect.right || at.y < rect.top || at.y > rect.bottom; button.setAttribute("aria-pressed", String(selected && i === options.selected())); setUiAttribute(button, "aria-label", uiMessage("Light {0}", i + 1)); if (at) {
                button.style.left = `${at.x - stage.left - 12}px`;
                button.style.top = `${at.y - stage.top - 12}px`;
            } });
            const index = options.selected(), light = lights[index], position = positions[index], at = position ? project(position) : undefined;
            tools.hidden = !selected || !at || icons[index]?.hidden === true;
            ring.setAttribute("points", "");
            cone.setAttribute("points", "");
            if (tools.hidden || !position || !at || !light)
                return;
            setUiText(label, uiMessage("Light {0}", index + 1));
            tools.style.left = `${Math.max(8, Math.min(rect.width - tools.offsetWidth - 8, at.x - stage.left + 18))}px`;
            const below = at.y - stage.top + 18;
            const top = below + tools.offsetHeight <= rect.height - 8 ? below : at.y - stage.top - tools.offsetHeight - 18;
            tools.style.top = `${Math.max(32, Math.min(rect.height - tools.offsetHeight - 8, top))}px`;
            const points = Array.from({ length: 49 }, (_, i) => project({ ...position, x: position.x + Math.cos(i * Math.PI / 24) * light.radius, y: position.y + Math.sin(i * Math.PI / 24) * light.radius }));
            if (points.every(Boolean))
                ring.setAttribute("points", points.map(p => `${p!.x - stage.left},${p!.y - stage.top}`).join(" "));
            if (light.spot) {
                const d = light.spot.direction, len = Math.hypot(d.x, d.y, d.elevation), end = project({ x: position.x + d.x / len * light.radius, y: position.y + d.y / len * light.radius, elevation: position.elevation + d.elevation / len * light.radius });
                if (end)
                    cone.setAttribute("points", `${at.x - stage.left},${at.y - stage.top} ${end.x - stage.left},${end.y - stage.top}`);
            }
        },
    };
}
