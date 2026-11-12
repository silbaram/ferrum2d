import { instantiateSceneFragment, resolveDataSceneInstanceComponents, resolveSceneAuthoringDocument, type ResolvedSceneAuthoringDocument, type SceneAuthoringDocumentSpec, type ScenePlacementViewerState, type ScenePlacementViewer } from "@ferrum2d/ferrum-web/authoring";
type ResolvedSceneCompositionInstance = NonNullable<ResolvedSceneAuthoringDocument['bindingPlan']>['instances'][number];
type SceneCompositionJsonValue = Parameters<ScenePlacementViewer['updateInstanceComponents']>[1];
import type { InspectorPropertyOriginal } from "./placementInspectorProperties";
import { formatStudioKitNumber } from "@ferrum2d/studio-kit";
type Target = {
    kind: string;
    id: string;
} | undefined;
export type InspectorResetPlan = {
    kind: "transform";
    updates: Parameters<ScenePlacementViewer["updateInstanceTransforms"]>[0];
} | {
    kind: "layers";
    updates: Parameters<ScenePlacementViewer["updateInstanceRenderLayers"]>[0];
} | {
    kind: "components";
    id: string;
    components: SceneCompositionJsonValue;
} | {
    kind: "spatial-input";
};
const record = (v: unknown): v is Record<string, SceneCompositionJsonValue> => !!v && typeof v === 'object' && !Array.isArray(v);
const scalar = (v: unknown) => typeof v === 'boolean' ? v : typeof v === 'number' || typeof v === 'string' ? String(v) : undefined;
const componentPaths: Readonly<Record<string, readonly string[]>> = { visualWidth: ['visual', 'width'], visualHeight: ['visual', 'height'], visualRadius: ['visual', 'radius'], colliderWidth: ['collider', 'halfWidth'], colliderHeight: ['collider', 'halfHeight'], colliderRadius: ['collider', 'radius'], colliderStartX: ['collider', 'startX'], colliderStartY: ['collider', 'startY'], colliderEndX: ['collider', 'endX'], colliderEndY: ['collider', 'endY'], colliderRotation: ['collider', 'rotationRadians'], colliderVertices: ['collider', 'vertices'], colliderOffsetX: ['collider', 'offsetX'], colliderOffsetY: ['collider', 'offsetY'], colliderEnabled: ['collider', 'enabled'], colliderTrigger: ['collider', 'isTrigger'], layer: ['layer'] };
function get(object: unknown, path: readonly string[]): SceneCompositionJsonValue | undefined { let value: unknown = object; for (const key of path) {
    if (!record(value))
        return undefined;
    value = value[key];
} return value as SceneCompositionJsonValue | undefined; }
/** Read-only authored baselines. No runtime, Wasm handles or secondary viewer is created. */
export function createPlacementInspectorOriginals(source: ResolvedSceneAuthoringDocument, colors: {
    normalize(value: string): string;
    primitive: string;
    point: string;
}, authoredSpatial: SceneAuthoringDocumentSpec['spatial']) {
    const fragments = new Map<string, { byId: Map<string, ResolvedSceneCompositionInstance>; bySource: Map<string, ResolvedSceneCompositionInstance | undefined> }>();
    const liveInstances = new WeakMap<ScenePlacementViewerState, Map<string, ScenePlacementViewerState['instances'][number]>>();
    const componentCache = new WeakMap<ResolvedSceneCompositionInstance, ReturnType<typeof resolveDataSceneInstanceComponents>>();
    function instances(fragment: string) {
        let index = fragments.get(fragment);
        if (!index) {
            const list = source.bindingPlan?.fragment === fragment ? source.bindingPlan.instances : instantiateSceneFragment(source.sceneComposition, { fragment });
            index = { byId: new Map(), bySource: new Map() };
            for (const instance of list) {
                index.byId.set(instance.id, instance);
                // Ambiguous source IDs never guess an original after a rename.
                index.bySource.set(instance.sourceId, index.bySource.has(instance.sourceId) ? undefined : instance);
            }
            fragments.set(fragment, index);
        }
        return index;
    }
    function currentInstances(state: ScenePlacementViewerState) {
        let index = liveInstances.get(state);
        if (!index) { index = new Map(state.instances.map(instance => [instance.instanceId, instance])); liveInstances.set(state, index); }
        return index;
    }
    function original(state: ScenePlacementViewerState, id = state.selectedInstanceId) {
        if (!id)
            return undefined;
        const index = instances(state.fragment), exact = index.byId.get(id);
        if (exact)
            return exact;
        const current = currentInstances(state).get(id);
        if (!current)
            return undefined;
        return index.bySource.get(current.sourceId);
    }
    function inline(instance: ResolvedSceneCompositionInstance | undefined) { if (!instance || !instance.props.components)
        return undefined; let c = componentCache.get(instance); if (!c) {
        c = resolveDataSceneInstanceComponents(instance, { allowTemplate: true });
        componentCache.set(instance, c);
    } return c.mode === 'inline' ? c : undefined; }
    function transformValue(instance: ResolvedSceneCompositionInstance, field: string) {
        const c = inline(instance), visual = c?.visual;
        if (field === 'layer')
            return visual?.kind === 'sprite' ? visual.layer ?? instance.layer : instance.layer;
        if (field === 'sortOrder')
            return visual?.kind === 'sprite' ? visual.sortOrder ?? 0 : 0;
        if (field === 'depthSort')
            return visual?.kind === 'sprite' && visual.depthSort === 'hd2d';
        return field === 'x' || field === 'y' || field === 'scale' || field === 'rotationRadians' ? instance[field] : undefined;
    }
    function rawPath(raw: unknown, field: string) { const path = Object.hasOwn(componentPaths, field) ? componentPaths[field] : undefined; if (!path)
        return undefined; if (path[0] === 'visual' && record(raw) && !record(raw.visual) && record(raw.sprite))
        return ['sprite', ...path.slice(1)]; return path; }
    function componentValue(instance: ResolvedSceneCompositionInstance, field: string) {
        const c = inline(instance);
        if (!c)
            return undefined;
        const v = c.visual, collider = c.collider;
        if (field === 'visualKind')
            return v.kind;
        if (field === 'primitiveShape')
            return v.kind === 'primitive' ? v.shape : 'rect';
        if (field === 'visualWidth')
            return v.width;
        if (field === 'visualHeight')
            return v.height;
        if (field === 'visualRadius')
            return v.kind === 'primitive' ? v.radius ?? Math.max(1, v.width * .5) : Math.max(1, Math.min(v.width, v.height) * .5);
        if (field === 'visualColor')
            return colors.normalize(v.kind === 'sprite' ? v.tint ?? v.color ?? colors.primitive : v.color ?? (v.shape === 'point' ? colors.point : colors.primitive));
        if (field === 'layer')
            return c.layer.name;
        if (field === 'colliderType')
            return collider.type;
        if (collider.type === 'none')
            return undefined;
        const path = Object.hasOwn(componentPaths, field) ? componentPaths[field] : undefined;
        if (!path)
            return undefined;
        const key = path.at(-1)!;
        if (field === 'colliderWidth' || field === 'colliderHeight') {
            const value = Reflect.get(collider, key);
            return typeof value === 'number' ? value * 2 : undefined;
        }
        if (field === 'colliderVertices' && collider.type === 'convexPolygon')
            return JSON.stringify(collider.vertices.map(p => ({ x: p.x, y: p.y })));
        return Reflect.get(collider, key);
    }
    function compatible(state: ScenePlacementViewerState, instance: ResolvedSceneCompositionInstance, field: string) {
        const baseline = inline(instance), current = state.selected;
        if (!baseline || !current)
            return false;
        if (field === 'visualColor' || field.startsWith('visual'))
            return current.visual?.kind === baseline.visual.kind && (current.visual.kind !== 'primitive' || baseline.visual.kind === 'primitive' && current.visual.shape === baseline.visual.shape);
        if (field.startsWith('collider'))
            return current.collider?.type === baseline.collider.type;
        return field === 'layer';
    }
    function spatialValue(state: ScenePlacementViewerState, target: Target, field: string) {
        if (!target)
            return undefined;
        if (field === 'lightMask' || field === 'shadowMask') {
            const id = target.kind === 'surface' ? target.id : original(state, target.id)?.id ?? target.id;
            const receiver = target.kind === 'surface' ? authoredSpatial?.terrain?.find(s => s.id === target.id)
                : target.kind === 'model' ? authoredSpatial?.models?.[id] : authoredSpatial?.billboards?.[id];
            return receiver ? { value: String(receiver[field] ?? 255), canRestore: receiver[field] !== undefined } : undefined;
        }
        if (target.kind === 'surface') {
            const terrain = authoredSpatial?.terrain?.find(s => s.id === target.id), value = terrain && Reflect.get(terrain, field);
            return { value: scalar(value ?? (field === 'floorId' ? 0 : undefined)), canRestore: value !== undefined };
        }
        const instance = original(state, target.id);
        if (!instance)
            return undefined;
        if (field === 'x' || field === 'y')
            return { value: String(instance[field]), canRestore: true };
        const raw = instance.props.components, span = get(raw, ['body', 'heightSpan']);
        if (field === 'elevation' || field === 'floorId') {
            const value = record(span) ? span[field] : undefined;
            return { value: scalar(value ?? (field === 'floorId' ? 0 : undefined)), canRestore: value !== undefined };
        }
        if (target.kind === 'model') {
            const model = authoredSpatial?.models?.[instance.id], key = field === 'offset' ? 'elevation' : field === 'yaw' ? 'yawDegrees' : field;
            const value = model && Reflect.get(model, key);
            return { value: scalar(value ?? (field === 'scale' ? 1 : 0)), canRestore: !!model && value !== undefined };
        }
        if (target.kind === 'billboard' && field === 'offset') {
            const billboard = authoredSpatial?.billboards?.[instance.id];
            return { value: scalar(billboard?.elevation ?? 0), canRestore: billboard?.elevation !== undefined };
        }
        if (target.kind === 'billboard' && (field === 'yaw' || field === 'scale'))
            return { value: String(field === 'yaw' ? instance.rotationRadians * 180 / Math.PI : instance.scale), canRestore: true };
        return undefined;
    }
    function read(key: string, state: ScenePlacementViewerState, target: Target): InspectorPropertyOriginal | undefined {
        const [kind, field] = key.split(':');
        if (!field)
            return undefined;
        if (kind === 'spatial') {
            const value = spatialValue(state, target, field);
            return value?.value === undefined ? undefined : { value: value.value, canRestore: value.canRestore };
        }
        const instance = original(state);
        if (!instance)
            return kind === 'transform' || kind === 'component' ? { value: '', canRestore: false } : undefined;
        if (kind === 'transform') {
            const rawValue = transformValue(instance, field), value = typeof rawValue === 'number' ? formatStudioKitNumber(rawValue) : scalar(rawValue);
            if (value === undefined)
                return undefined;
            const saved = state.selectedInstanceIds.map(id => original(state, id));
            const modified = state.selectedInstanceIds.some((id, index) => { const current = currentInstances(state).get(id), baseline = saved[index]; if (!current || !baseline)
                return true; const actual = field === 'layer' ? (current.visual?.kind === 'sprite' ? current.visual.layer ?? current.transform.layer : current.transform.layer) : field === 'sortOrder' ? (current.visual?.kind === 'sprite' ? current.visual.sortOrder ?? 0 : 0) : field === 'depthSort' ? current.visual?.kind === 'sprite' && current.visual.depthSort === 'hd2d' : field === 'x' || field === 'y' || field === 'scale' || field === 'rotationRadians' ? current.transform[field] : undefined; return actual !== transformValue(baseline, field); });
            return { value, canRestore: saved.every(Boolean), modified };
        }
        if (kind === 'component') {
            const rawValue = componentValue(instance, field), value = typeof rawValue === 'number' ? formatStudioKitNumber(rawValue) : scalar(rawValue);
            if (value === undefined)
                return undefined;
            return { value, canRestore: (Object.hasOwn(componentPaths, field) || field === 'visualColor') && compatible(state, instance, field) };
        }
        return undefined;
    }
    function plan(key: string, state: ScenePlacementViewerState, target: Target, document: SceneAuthoringDocumentSpec): InspectorResetPlan {
        const descriptor = read(key, state, target);
        if (!descriptor?.canRestore)
            throw Error('No restorable value in the opened document');
        const [kind, field] = key.split(':');
        if (kind === 'spatial')
            return { kind: 'spatial-input' };
        if (!state.selectedInstanceIds.length || state.selectedInstanceIds.some(id => state.lockedInstanceIds.includes(id)))
            throw Error('Unlock the selection before restoring properties');
        if (kind === 'transform') {
            if (field === 'layer' || field === 'sortOrder' || field === 'depthSort')
                return { kind: 'layers', updates: state.selectedInstanceIds.map(instanceId => { const value = transformValue(original(state, instanceId)!, field); return { instanceId, ...field === 'depthSort' ? { depthSort: value ? 'hd2d' as const : 'layer' as const } : field === 'sortOrder' ? { sortOrder: Number(value) } : { layer: Number(value) } }; }) };
            return { kind: 'transform', updates: state.selectedInstanceIds.map(instanceId => ({ instanceId, transform: { [field]: Number(transformValue(original(state, instanceId)!, field)) } })) };
        }
        const id = state.selectedInstanceId!;
        if (state.selectedInstanceIds.length !== 1)
            throw Error('Choose one object to restore a component field');
        const resolved = resolveSceneAuthoringDocument(document, { validateBindings: true, validateComponents: true, missingBehavior: 'ignore' });
        const current = (resolved.bindingPlan?.fragment === state.fragment ? resolved.bindingPlan.instances : instantiateSceneFragment(resolved.sceneComposition, { fragment: state.fragment })).find(i => i.id === id);
        const before = original(state)?.props.components, raw = current?.props.components;
        if (!record(raw) || !record(before))
            throw Error('Inline component source required');
        const components: Record<string, SceneCompositionJsonValue> = structuredClone(raw);
        if (field === 'visualColor') {
            const key = record(components.visual) ? 'visual' : 'sprite', oldKey = record(before.visual) ? 'visual' : 'sprite';
            const visual = components[key], old = before[oldKey];
            if (!record(visual) || !record(old))
                throw Error('Matching visual source required');
            for (const color of ['color', 'tint']) {
                if (Object.hasOwn(old, color))
                    Reflect.set(visual, color, structuredClone(old[color]));
                else
                    Reflect.deleteProperty(visual, color);
            }
        }
        else {
            const path = rawPath(components, field), oldPath = rawPath(before, field);
            if (!path || !oldPath)
                throw Error('Unsupported property restore');
            const parent = path.length === 1 ? components : get(components, path.slice(0, -1)), oldParent = oldPath.length === 1 ? before : get(before, oldPath.slice(0, -1));
            if (!record(parent) || !record(oldParent))
                throw Error('Matching component source required');
            const prop = path.at(-1)!, oldProp = oldPath.at(-1)!;
            if (Object.hasOwn(oldParent, oldProp))
                Reflect.set(parent, prop, structuredClone(oldParent[oldProp]));
            else
                Reflect.deleteProperty(parent, prop);
        }
        return { kind: 'components', id, components };
    }
    return { read, plan };
}
