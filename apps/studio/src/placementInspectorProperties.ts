import { formatUi, setUiAttribute, setUiText, uiContent, uiMessage, type UiContent } from "./placementLocale";
import { decorateViewportAction } from "./placementViewportChrome";
export type InspectorPropertyControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
// Spatial inputs move between cached document inspectors. Their presentation
// must have one owner too, without recreating the original inputs or handlers.
const inspectorPropertyOwners = new WeakMap<InspectorPropertyControl, { root: HTMLElement; release(): void }>();
export interface InspectorPropertyOriginal {
    value: string | boolean;
    canRestore: boolean;
    modified?: boolean;
}
export function inspectorPropertyKey(control: InspectorPropertyControl): string {
    return control.dataset.placementTransformField ? `transform:${control.dataset.placementTransformField}` : control.dataset.placementComponentField ? `component:${control.dataset.placementComponentField}` : control.dataset.placementSpatialField ? `spatial:${control.dataset.placementSpatialField}` : control.getAttribute('aria-label') ?? '';
}
/** Filters presentation metadata without replacing inputs or committing staged edits. */
export function createPlacementInspectorProperties(options: {
    root: HTMLElement;
    original(control: InspectorPropertyControl): InspectorPropertyOriginal | undefined;
    restore(control: InspectorPropertyControl): void;
}) {
    const element = document.createElement('div');
    element.className = 'placement-inspector-search';
    const search = document.createElement('input');
    search.type = 'search';
    search.dataset.placementPropertySearch = 'true';
    setUiAttribute(search, 'aria-label', 'Search properties');
    setUiAttribute(search, 'placeholder', 'Search properties');
    const clear = document.createElement('button');
    clear.type = 'button';
    setUiText(clear, 'Clear Filters');
    clear.dataset.placementPropertyClear = 'true';
    const changed = document.createElement('input');
    changed.type = 'checkbox';
    changed.dataset.placementPropertyChanged = 'true';
    const changedLabel = document.createElement('label'), changedText = document.createElement('span');
    setUiText(changedText, 'Modified Fields');
    changedLabel.append(changed, changedText);
    const advanced = document.createElement('input');
    advanced.type = 'checkbox';
    advanced.checked = true;
    advanced.dataset.placementPropertyAdvanced = 'true';
    const advancedLabel = document.createElement('label'), advancedText = document.createElement('span');
    setUiText(advancedText, 'Advanced Properties');
    advancedLabel.append(advanced, advancedText);
    const status = document.createElement('output');
    status.setAttribute('role', 'status');
    const error = document.createElement('output');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    element.append(search, clear, changedLabel, advancedLabel, status, error);
    const rows = new Map<InspectorPropertyControl, {
        row: HTMLElement;
        label: UiContent;
        key: string;
        restore: HTMLButtonElement;
    }>();
    function value(control: InspectorPropertyControl) { return control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : control.value; }
    function sync() {
        for (const control of options.root.querySelectorAll<InspectorPropertyControl>('input,select,textarea')) {
            if (element.contains(control) || control.type === 'hidden' || rows.has(control))
                continue;
            const label = control.closest('label');
            if (!label || label.closest('.placement-inspector-search'))
                continue;
            const caption = label.querySelector('span'), content = caption ? uiContent(caption) : control.getAttribute('aria-label') ?? label.textContent ?? '';
            const key = inspectorPropertyKey(control);
            if (!/^(transform|component|spatial):/.test(key))
                continue;
            inspectorPropertyOwners.get(control)?.release();
            const row = document.createElement('div');
            row.className = 'placement-property-row';
            label.before(row);
            row.append(label);
            const reset = document.createElement('button');
            reset.type = 'button';
            reset.dataset.placementPropertyReset = key;
            decorateViewportAction(reset, 'reset', 'Restore Original', undefined, true);
            setUiAttribute(reset, 'aria-label', uiMessage('Restore {0}', content));
            setUiAttribute(reset, 'title', 'Restore the value from the opened or saved document');
            row.append(reset);
            rows.set(control, { row, label: content, key, restore: reset });
            inspectorPropertyOwners.set(control, { root: options.root, release() {
                if (row.contains(label)) row.replaceWith(label);
                rows.delete(control);
                inspectorPropertyOwners.delete(control);
            } });
            reset.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                const ownedFocus = document.activeElement === reset;
                const original = options.original(control);
                if (reset.disabled || control.disabled || !original?.canRestore)
                    return;
                const previous = value(control);
                if (control instanceof HTMLInputElement && control.type === 'checkbox')
                    control.checked = original.value === true;
                else
                    control.value = String(original.value);
                try {
                    options.restore(control);
                    error.hidden = true;
                }
                catch (reason) {
                    if (control instanceof HTMLInputElement && control.type === 'checkbox')
                        control.checked = previous === true;
                    else
                        control.value = String(previous);
                    setUiText(error, uiMessage('Could not restore property: {0}', reason instanceof Error ? reason.message : String(reason)));
                    error.hidden = false;
                }
                sync();
                const focused = document.activeElement;
                if (ownedFocus && (focused === reset || focused === document.body) && (reset.hidden || reset.disabled || reset.closest('[hidden]'))) {
                    if (!control.disabled && !control.closest('[hidden]')) control.focus({ preventScroll: true });
                    else search.focus();
                }
            });
        }
        const query = search.value.trim().toLocaleLowerCase();
        let visible = 0, modified = 0;
        for (const [control, item] of rows) {
            if (!options.root.contains(control)) {
                const owner = inspectorPropertyOwners.get(control);
                if (owner?.root === options.root) owner.release();
                else rows.delete(control);
                continue;
            }
            const caption = control.closest('label')?.querySelector('span');
            if (caption) { item.label = uiContent(caption); setUiAttribute(item.restore, 'aria-label', uiMessage('Restore {0}', item.label)); }
            // Sections retain the original owner's hidden state; this filter
            // uses a separate attribute rather than overwriting that state.
            let ownerHidden = false;
            for (let node: HTMLElement | null = control; node && node !== options.root; node = node.parentElement)
                if (node !== item.row && node.hidden) { ownerHidden = true; break; }
            const original = options.original(control), current = value(control), diff = original !== undefined && (original.modified === true || String(original.value) !== String(current));
            if (diff && !ownerHidden)
                modified++;
            const text = (formatUi(item.label, 'en') + ' ' + formatUi(item.label, 'ko') + ' ' + item.key).toLocaleLowerCase();
            item.row.hidden = ownerHidden || !!query && !text.includes(query) || changed.checked && !diff;
            item.row.dataset.propertyModified = String(diff);
            item.restore.hidden = !original?.canRestore || !diff;
            item.restore.disabled = control.disabled || !original?.canRestore;
            if (!item.row.hidden)
                visible++;
        }
        for (const section of options.root.querySelectorAll<HTMLDetailsElement>('[data-section]')) {
            if (element.contains(section))
                continue;
            const technical = ['identity', 'diagnostics', 'document', 'handoff'].includes(section.dataset.section ?? '');
            const propertyRows = [...section.querySelectorAll<HTMLElement>('.placement-property-row')];
            section.toggleAttribute('data-placement-property-filtered', query || changed.checked ? propertyRows.length === 0 || propertyRows.every(row => row.hidden) : !advanced.checked && technical);
            if (query && propertyRows.some(row => !row.hidden))
                section.open = true;
        }
        setUiText(status, uiMessage('{0} fields · {1} modified', visible, modified));
    }
    search.addEventListener('input', sync);
    changed.addEventListener('change', sync);
    advanced.addEventListener('change', sync);
    options.root.addEventListener('input', event => { if (!element.contains(event.target as Node))
        sync(); });
    options.root.addEventListener('change', event => { if (!element.contains(event.target as Node))
        sync(); });
    search.addEventListener('keydown', event => { if (event.key === 'Escape' && search.value) {
        event.preventDefault();
        event.stopPropagation();
        search.value = '';
        sync();
    } });
    function resetFilters() { search.value = ''; changed.checked = false; advanced.checked = true; sync(); }
    clear.addEventListener('click', () => { resetFilters(); search.focus(); });
    return { element, sync, resetFilters };
}
