import { createPlacementControlMenu } from "./placementControlMenu";
import { setUiAttribute, setUiText, uiAttributeContent, type UiContent } from "./placementLocale";
/** Presentation only: original buttons retain their handlers, guards and IO owners. */
export function createPlacementToolActions(id: string, label: string, buttons: readonly HTMLButtonElement[]) {
    const element = document.createElement("div"), main = document.createElement("div");
    element.className = "placement-tool-actions";
    element.dataset.placementToolActions = id;
    element.setAttribute("role", "group");
    setUiAttribute(element, "aria-label", label);
    main.className = "placement-tool-primary";
    const more = createPlacementControlMenu(`tool-${id}`, "More Actions", "view");
    more.element.dataset.placementToolActionMenu = id;
    const secondary = document.createElement("div");
    secondary.className = "placement-tool-secondary";
    more.panel.append(secondary);
    element.append(main, more.element);
    secondary.addEventListener("click", event => {
        if (event.target instanceof Element && event.target.closest("button"))
            more.close(more.element.contains(element.ownerDocument.activeElement));
    });
    let primary: HTMLButtonElement | undefined;
    const notes = new Map(buttons.map(button => {
        const note = document.createElement("p");
        note.className = "placement-tool-action-note";
        note.id = `placement-action-note-${++fieldSequence}`;
        note.hidden = true;
        return [button, note] as const;
    }));
    function reasons(button: HTMLButtonElement) {
        for (const [action, note] of notes) {
            const show = action !== button && action.disabled;
            note.hidden = !show;
            describe(action, note.id, show);
            if (show)
                setUiText(note, uiAttributeContent(action, "title") ?? "Unavailable for the current source, selection or host");
            else
                note.textContent = "";
        }
    }
    return { element, menu: more.element, primary(button: HTMLButtonElement) {
            if (!buttons.includes(button))
                throw new Error("Unknown tool action");
            if (primary === button) {
                reasons(button);
                return;
            }
            const active = element.ownerDocument.activeElement;
            const ownedFocus = active instanceof HTMLElement && element.contains(active);
            if (primary) {
                delete primary.dataset.toolPrimary;
                if (primary.dataset.toolPrimaryReason)
                    describe(primary, primary.dataset.toolPrimaryReason, false);
                delete primary.dataset.toolPrimaryReason;
            }
            primary = button;
            button.dataset.toolPrimary = "true";
            main.append(button);
            notes.get(button)!.remove();
            for (const other of buttons)
                if (other !== button)
                    secondary.append(other, notes.get(other)!);
            reasons(button);
            more.close();
            if (ownedFocus)
                (button.disabled ? more.summary : button).focus({ preventScroll: true });
        }, close(restoreFocus = more.element.contains(element.ownerDocument.activeElement)) { more.close(restoreFocus); }, destroy: more.destroy };
}
let fieldSequence = 0;
function describe(control: HTMLElement, id: string, include: boolean) {
    const ids = new Set(control.getAttribute("aria-describedby")?.split(/\s+/).filter(Boolean) ?? []);
    if (include)
        ids.add(id);
    else
        ids.delete(id);
    if (ids.size)
        control.setAttribute("aria-describedby", [...ids].join(" "));
    else
        control.removeAttribute("aria-describedby");
}
/** Inline feedback without changing the owning field's commit or validation rules. */
export function createPlacementFieldFeedback(input: HTMLInputElement | HTMLSelectElement) {
    const element = document.createElement("span");
    element.id = `placement-field-feedback-${++fieldSequence}`;
    element.className = "placement-field-feedback";
    element.hidden = true;
    const descriptions = input.getAttribute("aria-describedby")?.split(/\s+/).filter(Boolean) ?? [];
    input.setAttribute("aria-describedby", [...descriptions, element.id].join(" "));
    return { element, set(message?: UiContent) {
            element.hidden = message === undefined;
            if (message === undefined) {
                input.removeAttribute("aria-invalid");
                element.textContent = "";
            }
            else {
                input.setAttribute("aria-invalid", "true");
                setUiText(element, message);
            }
        } };
}
/** A visible reason remains readable when the action itself is disabled. */
export function placementActionReason(button: HTMLButtonElement, reason: UiContent | undefined, element: HTMLElement) {
    element.hidden = reason === undefined;
    if (!element.id)
        element.id = `placement-action-reason-${++fieldSequence}`;
    describe(button, element.id, reason !== undefined);
    if (reason !== undefined) {
        button.dataset.toolPrimaryReason = element.id;
        setUiText(element, reason);
    }
    else {
        element.textContent = "";
        delete button.dataset.toolPrimaryReason;
    }
    setUiAttribute(element, "title", reason ?? "");
}
/** Workflow location only; reaching a step does not imply files have been saved. */
export function createPlacementToolSteps(label: string) {
    const element = document.createElement("ol");
    element.className = "placement-tool-steps";
    setUiAttribute(element, "aria-label", label);
    const items = ["Prepare Source", "Inspect and Preview", "Use Result"].map(caption => {
        const item = document.createElement("li");
        setUiText(item, caption);
        element.append(item);
        return item;
    });
    return { element, select(index: 0 | 1 | 2, busy = false) {
            element.dataset.step = String(index);
            element.setAttribute("aria-busy", String(busy));
            items.forEach((item, i) => {
                if (i === index)
                    item.setAttribute("aria-current", "step");
                else
                    item.removeAttribute("aria-current");
            });
        } };
}
