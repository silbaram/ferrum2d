import { resolveDataSceneComponentsSpec, instantiateSceneFragment, type SceneAuthoringDocumentSpec, type ScenePlacementBehaviorBindingPatch, type ScenePlacementPatch, type ScenePlacementViewerState } from '@ferrum2d/ferrum-web/authoring';
import type { PlacementTileAsset } from './placementTileAssets';
export interface TileMapPlacementOptions {
    originX?: number;
    originY?: number;
    layerBase?: number;
    collisionLayers?: readonly string[];
    objectPrefabs?: Readonly<Record<string, string>>;
}
interface MapCell { layer: string; column: number; row: number }
interface MapMarker { name: string; lineage: string; key: string; assetId?: string; cell?: MapCell }
const cellKey = (cell: MapCell) => `tile:${cell.layer}:${cell.column},${cell.row}`;
function fail(message: string): never { throw Error('Tile map: ' + message); }
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(16); };
const finite = (n: unknown, label: string, fallback = 0): number => { if (n === undefined)
    return fallback; if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e7)
    fail(label + ' is out of range'); return n; };
/** Pure cold authoring conversion. Source owns only the marked group in the active fragment. */
export function tileMapPlacementPatch(document: SceneAuthoringDocumentSpec, state: ScenePlacementViewerState, asset: PlacementTileAsset, options: TileMapPlacementOptions = {}, previousAssets: readonly PlacementTileAsset[] = []): ScenePlacementPatch {
    if (document.spatial)
        fail('whole map placement requires a flat 2D document');
    if (!options || typeof options !== 'object' || Array.isArray(options))
        fail('options must be an object');
    for (const key of Object.keys(options))
        if (!['originX', 'originY', 'layerBase', 'collisionLayers', 'objectPrefabs'].includes(key))
            fail('unknown option ' + key);
    const x = finite(options.originX, 'originX'), y = finite(options.originY, 'originY'), base = finite(options.layerBase, 'layerBase');
    if (!Number.isInteger(base) || base < -2147483648 || base > 2147482600)
        fail('layerBase is out of range');
    if (options.collisionLayers !== undefined && (!Array.isArray(options.collisionLayers) || options.collisionLayers.some(n => typeof n !== 'string')))
        fail('collisionLayers must contain names');
    const mappings = options.objectPrefabs ?? {};
    if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings) || Object.values(mappings).some(n => typeof n !== 'string' || !Object.hasOwn(document.sceneComposition.prefabs, n)))
        fail('objectPrefabs must reference existing prefabs');
    for (const prefab of new Set(Object.values(mappings)))
        resolveDataSceneComponentsSpec(document.sceneComposition.prefabs[prefab].props?.components, {allowTemplate:false,path:'tileMap.objectPrefabs.'+prefab});
    if (asset.selection?.omittedTileInstances)
        fail('selected tileset excludes tiles; import a single-tileset map for whole map placement');
    const source = JSON.parse(new TextDecoder().decode(asset.json));
    const rawLayers:Record<string,unknown>[] = asset.kind==='tiled'?source.layers:source.levels[asset.levelIndex].layerInstances;
    const sourceLayers = new Map<string,{index:number;layer:Record<string,unknown>}>();
    rawLayers.forEach((layer,index)=>{
        if(layer.visible===false)return;
        if(asset.kind==='tiled'&&layer.type==='group')fail('flatten Tiled group layers before whole-map placement');
        if(asset.kind==='tiled'&&!['tilelayer','objectgroup'].includes(String(layer.type)))fail('unsupported Tiled layer '+String(layer.type));
        const opacity=asset.kind==='tiled'?layer.opacity:layer.__opacity;
        if(opacity!==undefined&&opacity!==1||layer.tintcolor||layer.parallaxx!==undefined&&layer.parallaxx!==1||layer.parallaxy!==undefined&&layer.parallaxy!==1)fail('layer opacity/tint/parallax require an explicit adapter');
        const name=String((asset.kind==='tiled'?layer.name:layer.__identifier)??'layer-'+index);
        if(sourceLayers.has(name))fail('layer names must be unique');
        sourceLayers.set(name,{index,layer});
    });
    if(asset.kind==='tiled'){
        const sets=[...(source.tilesets??[]),...(asset.dependencies??[]).map(d=>JSON.parse(new TextDecoder().decode(d.json)))];
        for(const set of sets){
            if(set.tileoffset&&(set.tileoffset.x||set.tileoffset.y))fail('nonzero Tiled tileset offsets require an explicit adapter');
            if((set.tiles??[]).some((t:{animation?:unknown})=>t.animation))fail('animated Tiled tiles require an explicit runtime adapter');
        }
    }
    const imported = asset.imported, tm = imported.tilemap, layers = tm.layers ?? [], names = layers.map((l, i) => l.name ?? 'layer-' + i);
    if (new Set(names).size !== names.length)
        fail('layer names must be unique');
    for (const name of options.collisionLayers ?? [])
        if (!names.includes(name))
            fail('unknown collision layer ' + name);
    const fragment = state.fragment;
    if (!Object.hasOwn(document.sceneComposition.fragments ?? {}, fragment))
        fail('unknown active fragment');
    const instances = instantiateSceneFragment(document.sceneComposition, { fragment });
    const direct = new Map((document.sceneComposition.fragments![fragment].instances ?? []).map(i => [i.id, i]));
    const owned = instances.filter(i => { const marker = i.props.tileMapImport as {
        name?: string;
    } | undefined; return marker?.name === asset.name; });
    const ownedByKey = new Map<string, typeof owned[number]>();
    for (const i of owned) {
        const marker = i.props.tileMapImport as unknown as MapMarker;
        if (marker.lineage !== asset.lineage)
            fail('source identity changed; choose a different map name');
        if (state.lockedInstanceIds.includes(i.id))
            fail('unlock the imported map before replacing it');
        const original = direct.get(i.id);
        if (!original) fail('open the owning fragment before replacing an included map');
        for (const key of Object.keys(original.props ?? {}))
            if (!['components', 'tileMapImport', 'behaviorRecipes'].includes(key))
                fail(`instance ${i.id} has unsupported authored prop ${key}; preserve it explicitly before reimport`);
        const key = marker.key.startsWith('tile:') ? cellKey(sourceCell(marker, previousAssets)) : marker.key;
        if (ownedByKey.has(key)) fail('duplicate source cell/object identity');
        ownedByKey.set(key, i);
    }
    const prefix = 'map_' + asset.name + '_' + hash(fragment), prefab = prefix + '_tile';
    const existingIds = new Set(instances.map(i => i.id)), newIds = new Set<string>();
    const operations: ScenePlacementPatch['operations'][number][] = [];
    const definition = document.sceneComposition.prefabs[prefab];
    const definitionOwner = definition?.props?.tileMapImport as {name?:string;lineage?:string}|undefined;
    if (definition && (definitionOwner?.name !== asset.name || definitionOwner.lineage !== asset.lineage))
        fail('map prefab name collides with a project prefab or different source identity');
    if (!definition)
        operations.push({ kind: 'addObjectDefinition', id: prefab, definition: { props: { tileMapImport: { name: asset.name, lineage: asset.lineage, key: 'definition' } } } });
    for (const i of owned)
        operations.push({ kind: 'removeInstance', instanceId: i.id });
    let count = 0;
    const add = (key: string, objectPrefab: string, px: number, py: number, layer: number, props: Record<string, unknown>, cell?: MapCell) => {
        if (++count > 2048)
            fail('whole map exceeds 2048 instances');
        const previous = ownedByKey.get(key), original = previous ? direct.get(previous.id)! : undefined;
        const id = previous?.id ?? prefix + '_' + hash(key);
        if (newIds.has(id) || existingIds.has(id) && previous?.id !== id)
            fail('generated instance id collision');
        newIds.add(id);
        // Keep legacy keys as stable aliases while explicit grid coordinates migrate
        // their meaning. Existing saved IDs and agent references remain unchanged.
        const identity = previous ? (previous.props.tileMapImport as unknown as MapMarker).key : key;
        const { tileMapObject, ...componentsProps } = props;
        const ownedProps = { ...componentsProps, tileMapImport: { ...(tileMapObject ? { object: tileMapObject } : {}), name: asset.name, lineage: asset.lineage, assetId: asset.id, key: identity, ...(cell ? { cell } : {}), ...(count === 1 ? { options: structuredClone(options) } : {}) } };
        operations.push({ kind: 'addInstance', fragment, instance: { id, prefab: objectPrefab, ...(original?.prefab === objectPrefab && original.variant !== undefined ? { variant: original.variant } : {}), x: finite(px, 'tile x'), y: finite(py, 'tile y'), layer, props: ownedProps as never } });
        if (original?.props && Object.hasOwn(original.props, 'behaviorRecipes'))
            operations.push({ kind: 'updateBehaviorBinding', target: { kind: 'instance', instanceId: id }, behaviorRecipes: copyBinding(original.props.behaviorRecipes) });
    };
    const frames = new Map(asset.frames.map(f => [f.id, f]));
    layers.forEach((layer, index) => {
        const w = finite(layer.tileWidth ?? tm.tileWidth, 'tile width'), h = finite(layer.tileHeight ?? tm.tileHeight, 'tile height');
        if (w <= 0 || h <= 0)
            fail('invalid tile size');
        const columns = layer.columns!, rows = layer.rows!, data = layer.data!;
        if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns <= 0 || rows <= 0 || data.length !== columns * rows)
            fail('invalid tile grid');
        const raw=sourceLayers.get(names[index]);if(!raw)fail('source layer missing');
        const sx=asset.kind==='tiled'?finite(raw.layer.offsetx,'layer offset x')+finite(raw.layer.x,'layer grid x')*w:0;
        const sy=asset.kind==='tiled'?finite(raw.layer.offsety,'layer offset y')+finite(raw.layer.y,'layer grid y')*h:0;
        const ox = x + finite(tm.origin?.x, 'map x') + finite(layer.origin?.x, 'layer x')+sx, oy = y + finite(tm.origin?.y, 'map y') + finite(layer.origin?.y, 'layer y')+sy;
        const z = base + (asset.kind === 'ldtk' ? rawLayers.length - 1 - raw.index : raw.index);
        data.forEach((tile, cell) => {
            if (tile === 0)
                return;
            const spec = tm.tiles?.[String(tile)], frame = spec?.frame ? frames.get(spec.frame) : undefined;
            if (!spec || !frame)
                fail('missing tile frame ' + tile);
            if(frame.width!==w||frame.height!==h)fail('whole-map tiles must match the map cell size');
            if (spec.blocksProjectile!==undefined||spec.blocksVision!==undefined||spec.occluderHeight!==undefined)fail('projectile/vision tile metadata requires an explicit runtime adapter');
            if (spec.slope || spec.oneWayPlatform || spec.ramp || spec.bridgePortal || spec.kind && spec.kind !== 'flat' || spec.elevation || spec.floor || spec.height)
                fail('spatial/sloped tile metadata requires a separate runtime map adapter');
            const solid = spec.blocksMovement ?? (layer.collision === true || (options.collisionLayers ?? []).includes(names[index]));
            const coordinate = { layer: names[index], column: cell % columns, row: Math.floor(cell / columns) };
            add(cellKey(coordinate), prefab, ox + (cell % columns + .5) * w, oy + (Math.floor(cell / columns) + .5) * h, z, { components: {
                    visual: { kind: 'sprite', asset: asset.id, width: w, height: h, originX: .5, originY: .5, layer: z, frame: frame.uv },
                    collider: solid ? { type: 'aabb', halfWidth: w / 2, halfHeight: h / 2, isTrigger: false } : 'none', layer: 'wall', ...(solid ? { body: { type: 'static' } } : {}),
                } }, coordinate);
        });
    });
    if ('entities' in imported)
        for (const e of imported.entities) {
            const target = Object.hasOwn(mappings, e.identifier) ? mappings[e.identifier] : undefined;
            if (!target)
                fail('provide objectPrefabs mapping for ' + e.identifier);
            add('entity:' + e.layerName + ':' + (e.iid ?? e.identifier + ':' + e.x + ':' + e.y), target, x + e.x, y + e.y, base + rawLayers.length - 1 - e.layerIndex, { tileMapObject: { kind: 'ldtk', identifier: e.identifier, fields: e.fields } });
        }
    else {
        const walk = (items: Record<string, unknown>[], ox = 0, oy = 0) => {
            for (const l of items) {
                if (l.visible === false)
                    continue;
                if (l.opacity !== undefined && l.opacity !== 1 || l.tintcolor || l.parallaxx !== undefined && l.parallaxx !== 1 || l.parallaxy !== undefined && l.parallaxy !== 1)
                    fail('layer opacity/tint/parallax require an explicit adapter');
                if (!['tilelayer', 'objectgroup', 'group'].includes(String(l.type)))
                    fail('unsupported whole-map layer ' + String(l.type));
                if (l.type === 'objectgroup' && (l.x || l.y))
                    fail('nonzero object layer grid offsets require an explicit adapter');
                const lx = ox + finite(l.offsetx, 'object offset x'), ly = oy + finite(l.offsety, 'object offset y');
                if (l.type === 'group')
                    walk(l.layers as Record<string, unknown>[], lx, ly);
                if (l.type !== 'objectgroup')
                    continue;
                for (const o of l.objects as Record<string, unknown>[]) {
                    if (o.visible === false)
                        continue;
                    if (o.rotation || o.gid || o.ellipse || o.polygon || o.polyline || o.text || o.template)
                        fail('only unrotated rectangle/point Tiled objects are supported');
                    const type = String(o.class || o.type || ''), target = Object.hasOwn(mappings, type) ? mappings[type] : undefined;
                    if (!target)
                        fail('provide objectPrefabs mapping for ' + type);
                    const width = finite(o.width, 'object width'), height = finite(o.height, 'object height');
                    if(width<0||height<0)fail('object size must be non-negative');
                    add('object:' + String(l.name) + ':' + String(o.id), target, x + lx + finite(o.x, 'object x') + width / 2, y + ly + finite(o.y, 'object y') + height / 2, base + (sourceLayers.get(String(l.name))?.index??layers.length), { tileMapObject: { kind: 'tiled', type, sourceId: o.id, properties: o.properties ?? [] } });
                }
            }
        };
        walk(source.layers);
    }
    if (!count)
        fail('map is empty');
    return { format: 'ferrum2d.scene-placement.patch', version: 2, operations };
}

/** Legacy linear keys need the exact original revision; edited poses are not an identity oracle. */
function sourceCell(marker: MapMarker, previousAssets: readonly PlacementTileAsset[]): MapCell {
    if (marker.cell !== undefined) {
        const cell = marker.cell;
        if (!cell || typeof cell.layer !== 'string' || !cell.layer.length ||
            ![cell.column, cell.row].every(n => Number.isInteger(n) && n >= 0 && n < 256))
            fail('invalid stored cell identity');
        return cell;
    }
    const source = previousAssets.find(a => a.id === marker.assetId && a.lineage === marker.lineage && a.name === marker.name);
    if (!source) fail('legacy map cells require the original source revision; reopen its catalog before reimport');
    for (const [index, layer] of (source.imported.tilemap.layers ?? []).entries()) {
        const name = layer.name ?? 'layer-' + index, prefix = 'tile:' + name + ':';
        if (!marker.key.startsWith(prefix)) continue;
        const suffix = marker.key.slice(prefix.length);
        if (!/^(0|[1-9][0-9]*)$/.test(suffix)) continue;
        const offset = Number(suffix), columns = layer.columns!, rows = layer.rows!;
        if (!Number.isSafeInteger(offset) || offset >= columns * rows) fail('invalid legacy cell index');
        return { layer: name, column: offset % columns, row: Math.floor(offset / columns) };
    }
    return fail('legacy cell layer is missing from the original source revision');
}
function copyBinding(value: unknown): ScenePlacementBehaviorBindingPatch {
    if (value === null || typeof value === 'string' && value.length) return value;
    if (Array.isArray(value)) {
        const ids: string[] = [];
        for (const id of value) {
            if (typeof id !== 'string' || !id.length) fail('invalid instance behavior binding');
            ids.push(id);
        }
        return ids;
    }
    return fail('invalid instance behavior binding');
}
