import { setUiAttribute, setUiText, uiMessage, type UiContent } from "./placementLocale";
export interface PlacementBrowserAsset {
    key: string;
    kind: "sprite" | "model";
    id: string;
    label: string;
    frameId?: string;
    contentId?: string;
    thumbnail?: string;
    uv?: {
        u0: number;
        v0: number;
        u1: number;
        v1: number;
    };
}
/** UI selection is independent from scene selection and the armed placement tool. */
export function createPlacementAssetBrowser(options: {
    entries(): readonly PlacementBrowserAsset[];
    choose(asset: PlacementBrowserAsset): void;
    drag(event: DragEvent, asset: PlacementBrowserAsset): void;
    dragging(): boolean;
    canUse(asset: PlacementBrowserAsset): boolean;
    projectKey(): string;
    selected(asset: PlacementBrowserAsset): boolean;
    target?(): string | undefined;
    unavailable?(asset: PlacementBrowserAsset): UiContent;
    usage?(asset: PlacementBrowserAsset): void;
    normal?(asset: PlacementBrowserAsset): void;
    editPixels?(asset: PlacementBrowserAsset): void;
}) {
    const element = document.createElement("section");
    element.className = "placement-asset-browser";
    element.dataset.placementAssetBrowser = "true";
    const search = document.createElement("input");
    search.type = "search";
    setUiAttribute(search, "placeholder", "Search Assets");
    setUiAttribute(search, "aria-label", "Search assets");
    search.dataset.placementAssetSearch = "true";
    const filter = document.createElement("select");
    setUiAttribute(filter, "aria-label", "Asset filter");
    filter.dataset.placementAssetFilter = "true";
    for (const [value, label] of [["all", "All"], ["sprite", "Sprites"], ["model", "Models"], ["recent", "Recent"], ["favorite", "Favorites"]]) {
        const option = document.createElement("option");
        option.value = value;
        setUiText(option, label);
        filter.append(option);
    }
    const view = document.createElement("select");
    view.dataset.placementAssetView = "true";
    setUiAttribute(view, "aria-label", "Asset display");
    for (const [value, label] of [["tiles", "Tiles"], ["list", "List"]]) {
        const o = document.createElement("option");
        o.value = value;
        setUiText(o, label);
        view.append(o);
    }
    const toolbar = document.createElement("div");
    toolbar.className = "placement-asset-toolbar";
    toolbar.append(search, filter, view);
    const body = document.createElement("div");
    body.className = "placement-asset-body";
    body.dataset.panel = "list";
    const grid = document.createElement("div");
    grid.className = "placement-asset-grid";
    setUiAttribute(grid, "aria-label", "Asset results");
    const detail = document.createElement("section");
    detail.className = "placement-asset-detail";
    detail.dataset.placementAssetDetail = "true";
    const title = document.createElement("strong"), image = document.createElement("span"), metadata = document.createElement("dl"), target = document.createElement("p"), reason = document.createElement("p"), actions = document.createElement("div");
    image.className = "placement-browser-thumbnail";
    actions.className = "placement-asset-detail-actions";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "placement-asset-back";
    setUiText(back, "Back to Assets");
    function action(label: string) { const button = document.createElement("button"); button.type = "button"; setUiText(button, label); actions.append(button); return button; }
    const place = action("Place Asset"), edit = action("Edit Pixels"), normal = action("Normal"), usage = action("Asset Usage");
    place.dataset.placementAssetPlace = "true";
    usage.dataset.placementAssetUsageOpen = "true";
    detail.append(back, title, image, metadata, target, reason, actions);
    body.append(grid, detail);
    const status = document.createElement("output");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    element.append(toolbar, body, status);
    let project = "", favorites: string[] = [], recent: string[] = [], inspected: string | undefined;
    let signature: readonly (readonly unknown[])[] | undefined;
    const rendered = new Map<HTMLButtonElement, PlacementBrowserAsset>();
    const scrollPositions = new Map<string, number>();
    let filterKey = "";
    let detailSignature: readonly unknown[] | undefined;
    let renderPending = false;
    const storageKey = () => "ferrum.placement.assets.v1:" + project;
    function save() {
        try {
            localStorage.setItem(storageKey(), JSON.stringify({ favorites, recent, view: view.value }));
        }
        catch { /* optional UI preferences */ }
    }
    function remember(key: string) { recent = [key, ...recent.filter(v => v !== key)].slice(0, 24); save(); }
    const current = () => options.entries().find(a => a.key === inspected);
    function thumbnail(node: HTMLElement, asset: PlacementBrowserAsset) {
        node.textContent = "";
        node.style.backgroundImage = "";
        node.style.backgroundSize = "";
        node.style.backgroundPosition = "";
        if (asset.thumbnail) {
            node.style.backgroundImage = `url(${JSON.stringify(asset.thumbnail)})`;
            if (asset.uv) {
                const { u0, v0, u1, v1 } = asset.uv, du = u1 - u0, dv = v1 - v0;
                node.style.backgroundSize = `${100 / du}% ${100 / dv}%`;
                node.style.backgroundPosition = `${du === 1 ? 0 : 100 * u0 / (1 - du)}% ${dv === 1 ? 0 : 100 * v0 / (1 - dv)}%`;
            }
        }
        else
            setUiText(node, asset.kind === "model" ? "GLB" : "IMG");
    }
    function syncSelection() {
        for (const [button, asset] of rendered) {
            button.setAttribute("aria-pressed", String(inspected === asset.key));
            button.dataset.inspected = String(inspected === asset.key);
            button.dataset.selected = String(options.selected(asset));
        }
    }
    function details() {
        const asset = current();
        const targetId = options.target?.(), usable = asset ? options.canUse(asset) : false;
        const unavailable = asset && !usable ? options.unavailable?.(asset) ?? "Placement is unavailable in the current view" : undefined;
        // Compare scalar fields without serializing potentially large data URLs
        // on pointer sync. The action nodes and their focus remain stable.
        const signature = [asset?.key, asset?.label, asset?.id, asset?.kind, asset?.frameId, asset?.contentId, asset?.thumbnail, asset?.uv?.u0, asset?.uv?.v0, asset?.uv?.u1, asset?.uv?.v1, targetId, usable, typeof unavailable === 'object' ? JSON.stringify(unavailable) : unavailable];
        if (detailSignature?.every((value,index)=>value===signature[index])) return;
        detailSignature = signature;
        detail.dataset.assetKey = asset?.key ?? "";
        metadata.replaceChildren();
        setUiText(title, asset ? asset.label : "Select an asset to inspect");
        image.hidden = target.hidden = reason.hidden = actions.hidden = !asset;
        if (!asset)
            return;
        thumbnail(image, asset);
        for (const [label, value] of [["Asset ID", asset.id], ["Kind", asset.kind === "model" ? "Model" : "Sprite"], ["Frame", asset.frameId], ["Content ID", asset.contentId]] as const) {
            if (value === undefined)
                continue;
            const dt = document.createElement("dt"), dd = document.createElement("dd");
            setUiText(dt, label);
            if (label === "Kind")
                setUiText(dd, value);
            else
                dd.textContent = value;
            metadata.append(dt, dd);
        }
        setUiText(target, targetId ? uiMessage("Scene selection · {0}", targetId) : "No scene object selected");
        place.disabled = !usable;
        setUiText(place, asset.kind === "model" && !asset.contentId ? "Load Model" : "Place Asset");
        edit.hidden = asset.kind !== "sprite" || !asset.thumbnail || !options.editPixels;
        normal.hidden = asset.kind !== "sprite" || !!asset.frameId || !asset.thumbnail || !options.normal;
        edit.disabled = normal.disabled = !usable;
        usage.hidden = !options.usage;
        edit.dataset.placementEditPixels = asset.id;
        if (asset.frameId)
            edit.dataset.placementEditPixelFrame = asset.frameId;
        else
            delete edit.dataset.placementEditPixelFrame;
        setUiAttribute(edit, "aria-label", uiMessage("Edit Pixels {0}", asset.label));
        setUiAttribute(normal, "aria-label", uiMessage("Generate Normal {0}", asset.label));
        reason.hidden = usable;
        if (!usable)
            setUiText(reason, unavailable!);
    }
    function inspect(asset: PlacementBrowserAsset, show = true) {
        inspected = asset.key;
        remember(asset.key);
        if (show)
            body.dataset.panel = "details";
        syncSelection();
        details();
    }
    function perform(callback: ((asset: PlacementBrowserAsset) => void) | undefined, requiresUse = true) {
        const asset = current();
        if (asset && (!requiresUse || options.canUse(asset)))
            callback?.(asset);
    }
    place.addEventListener("click", () => perform(options.choose));
    edit.addEventListener("click", () => perform(options.editPixels));
    normal.addEventListener("click", () => perform(options.normal));
    usage.addEventListener("click", () => perform(options.usage, false));
    back.addEventListener("click", () => { body.dataset.panel = "list"; [...rendered].find(([, a]) => a.key === inspected)?.[0].focus({ preventScroll: true }); });
    function render() {
        if (options.dragging()) { renderPending = true; syncSelection(); details(); return; }
        renderPending = false;
        const oldScroll = grid.scrollTop, active = element.ownerDocument.activeElement;
        const favoriteFocused = active instanceof HTMLButtonElement && active.classList.contains("placement-asset-favorite");
        const focusedCard = favoriteFocused ? active.previousElementSibling : active;
        const focusedKey = focusedCard instanceof HTMLButtonElement ? rendered.get(focusedCard)?.key : undefined;
        scrollPositions.set(filterKey, oldScroll);
        if (scrollPositions.size > 32)
            scrollPositions.delete(scrollPositions.keys().next().value!);
        const nextFilterKey = JSON.stringify([search.value, filter.value, view.value]);
        const restoreScroll = nextFilterKey === filterKey ? oldScroll : scrollPositions.get(nextFilterKey) ?? 0;
        filterKey = nextFilterKey;
        const query = search.value.trim().toLocaleLowerCase();
        let entries = options.entries().filter(a => (a.label + " " + a.id + " " + (a.frameId ?? "")).toLocaleLowerCase().includes(query) && (filter.value === "all" || filter.value === a.kind || filter.value === "favorite" && favorites.includes(a.key) || filter.value === "recent" && recent.includes(a.key)));
        if (filter.value === "recent")
            entries = [...entries].sort((a, b) => recent.indexOf(a.key) - recent.indexOf(b.key));
        grid.replaceChildren();
        rendered.clear();
        element.dataset.assetView = view.value;
        for (const asset of entries.slice(0, 300)) {
            const cell = document.createElement("div");
            cell.className = "placement-asset-cell";
            const button = document.createElement("button");
            button.type = "button";
            button.dataset.placementBrowserAsset = asset.key;
            button.title = asset.label;
            button.draggable = options.canUse(asset);
            rendered.set(button, asset);
            const thumb = document.createElement("span"), label = document.createElement("span");
            thumb.className = "placement-browser-thumbnail";
            thumbnail(thumb, asset);
            label.textContent = asset.label;
            button.append(thumb, label);
            button.addEventListener("click", () => inspect(asset));
            button.addEventListener("dblclick", () => { inspect(asset); perform(options.choose); });
            button.addEventListener("dragstart", event => { inspect(asset, false); options.drag(event, asset); syncSelection(); });
            const favorite = document.createElement("button");
            favorite.type = "button";
            favorite.className = "placement-asset-favorite";
            const star = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            star.setAttribute("viewBox", "0 0 24 24");
            star.setAttribute("aria-hidden", "true");
            star.setAttribute("width", "16");
            star.setAttribute("height", "16");
            const path = document.createElementNS(star.namespaceURI, "path");
            path.setAttribute("d", "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z");
            star.append(path);
            favorite.append(star);
            setUiAttribute(favorite, "title", favorites.includes(asset.key) ? "Remove favorite" : "Add favorite");
            setUiAttribute(favorite, "aria-label", uiMessage("Favorite {0}", asset.label));
            favorite.setAttribute("aria-pressed", String(favorites.includes(asset.key)));
            favorite.addEventListener("click", () => { favorites = favorites.includes(asset.key) ? favorites.filter(k => k !== asset.key) : [...favorites, asset.key].slice(-128); save(); render(); });
            cell.append(button, favorite);
            grid.append(cell);
        }
        syncSelection();
        details();
        grid.scrollTop = restoreScroll;
        if (focusedKey) {
            const card = [...rendered].find(([, a]) => a.key === focusedKey)?.[0];
            const target = favoriteFocused ? card?.nextElementSibling : card;
            if (target instanceof HTMLElement)
                target.focus({ preventScroll: true });
            else if (favoriteFocused)
                ([...rendered.keys()][0] ?? filter).focus({ preventScroll: true });
        }
        setUiText(status, entries.length ? uiMessage("{0} assets{1}", entries.length, entries.length > 300 ? uiMessage(" · Showing first 300; refine search") : uiMessage("")) : "No matching assets");
    }
    grid.addEventListener("keydown", event => {
        if (!(event.target instanceof HTMLButtonElement) || !rendered.has(event.target) || event.altKey || event.ctrlKey || event.metaKey)
            return;
        const keys = [...rendered.keys()], i = keys.indexOf(event.target);
        let next: HTMLButtonElement | undefined;
        if (event.key === "ArrowRight" || event.key === "ArrowDown")
            next = keys[(i + 1) % keys.length];
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
            next = keys[(i + keys.length - 1) % keys.length];
        else if (event.key === "Home")
            next = keys[0];
        else if (event.key === "End")
            next = keys.at(-1);
        if (next) {
            event.preventDefault();
            event.stopPropagation();
            next.focus();
            inspect(rendered.get(next)!, false);
        }
    });
    search.addEventListener("input", render);
    filter.addEventListener("change", render);
    view.addEventListener("change", () => { save(); render(); });
    return { element, inspect(key: string) {
            const asset = options.entries().find(a => a.key === key);
            if (asset)
                inspect(asset);
        }, sync() {
            const nextProject = options.projectKey();
            if (project !== nextProject) {
                project = nextProject;
                favorites = [];
                recent = [];
                inspected = undefined;
                scrollPositions.clear();
                filterKey = "";
                grid.scrollTop = 0;
                body.dataset.panel = "list";
                view.value = "tiles";
                try {
                    const value: unknown = JSON.parse(localStorage.getItem(storageKey()) ?? "null");
                    if (value && typeof value === "object") {
                        const read = (key: string, max: number) => { const list: unknown = Reflect.get(value, key); return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string" && v.length < 1024).slice(-max) : []; };
                        favorites = read("favorites", 128);
                        recent = read("recent", 24);
                        if (Reflect.get(value, "view") === "list")
                            view.value = "list";
                    }
                }
                catch { /* malformed preference fallback */ }
                signature = undefined;
            }
            const next = options.entries().map(a => [a.key, a.id, a.kind, a.label, a.frameId, a.uv?.u0, a.uv?.v0, a.uv?.u1, a.uv?.v1, a.contentId, a.thumbnail, options.canUse(a)]);
            const previous = signature;
            if (renderPending || !previous || next.length!==previous.length || next.some((row,index)=>row.some((value,field)=>value!==previous[index][field]))) {
                signature = next;
                render();
            }
            else {
                syncSelection();
                details();
            }
        } };
}
