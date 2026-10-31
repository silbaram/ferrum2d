import type { createPixelEditor, PixelFrameTag } from "./placementPixelDocument";
import { PIXEL_LIMITS } from "./placementPixelDocument";
import { setUiText, setUiAttribute, uiMessage } from "./placementLocale";

/** Asset-only tag authoring. Selection and preview scope are never saved. */
export function createPixelTags(options: {
  editor(): ReturnType<typeof createPixelEditor>; disabled(): boolean;
  perform(run: () => void): void; viewChanged(): void;
}) {
  const element = document.createElement("details"); element.className = "placement-pixel-tags";
  const summary = document.createElement("summary"); setUiText(summary, "Frame Tags");
  const panel = document.createElement("div"), select = document.createElement("select");
  panel.className = "placement-pixel-tag-panel";
  select.dataset.pixelTagSelect = "true"; setUiAttribute(select, "aria-label", "Preview Tag");
  const name = document.createElement("input"); name.type = "text"; name.maxLength = 64;
  name.dataset.pixelTagName = "true"; setUiAttribute(name, "aria-label", "Tag Name");
  const loop = document.createElement("input"); loop.type = "checkbox"; loop.dataset.pixelTagLoop = "true";
  const loopLabel = document.createElement("label"), loopText = document.createElement("span");
  setUiText(loopText, "Loop"); loopLabel.append(loop, loopText);
  const actions = document.createElement("div"); actions.className = "placement-pixel-tag-actions";
  const buttons = new Map<string, HTMLButtonElement>();
  function button(action: string, title: string, run: () => void) {
    const node = document.createElement("button"); node.type = "button"; node.dataset.pixelTagAction = action;
    setUiText(node, title); node.onclick = () => perform(run); actions.append(node); buttons.set(action, node);
  }
  let selected = "", previous: ReturnType<typeof createPixelEditor> | undefined, signature = "";
  const frames = document.createElement("div"); frames.className = "placement-pixel-tag-frames";
  const hint = document.createElement("p"); setUiText(hint, "Clip IDs are preserved. Select frames in playback order.");
  panel.append(select, name, loopLabel, actions, frames, hint); element.append(summary, panel);
  const rows = new Map<string, { label: HTMLLabelElement; input: HTMLInputElement; text: HTMLSpanElement }>();
  const current = () => options.editor().tags().find(tag => tag.id === selected);
  function update(change: Partial<Pick<PixelFrameTag, "name" | "frameIds" | "loop">>) {
    const tag = current(); if (tag) options.editor().updateTag(tag.id, { ...tag, ...change });
  }
  button("add", "Add Tag", () => {
    const tags = options.editor().tags(); let n = tags.length + 1;
    while (tags.some(tag => tag.name === "Tag " + n)) n++;
    selected = options.editor().addTag("Tag " + n, [options.editor().selectedFrame()]);
  });
  button("remove", "Remove Tag", () => {
    options.editor().removeTag(selected); selected = options.editor().initialTag();
  });
  button("initial", "Initial Clip", () => options.editor().setInitialTag(selected));
  select.onchange = () => {
    if (options.disabled()) return;
    selected = select.value; signature = ""; options.viewChanged(); sync();
  };
  name.onchange = () => perform(() => update({ name: name.value }));
  loop.onchange = () => perform(() => update({ loop: loop.checked }));
  name.addEventListener("keydown", event => {
    if (event.isComposing) return;
    if (event.code === "Enter") { event.preventDefault(); name.dispatchEvent(new Event("change")); }
    if (event.code === "Escape") { event.preventDefault(); signature = ""; sync(); }
  });
  element.addEventListener("keydown", event => {
    if (event.isComposing || event.code !== "Escape" || !element.open) return;
    event.preventDefault(); event.stopPropagation(); element.open = false; summary.focus();
  });
  function perform(run: () => void) {
    options.perform(run);
    // Invalid edits leave the model unchanged; restore their input values too.
    signature = ""; sync();
  }
  function sync() {
    const editor = options.editor(), tags = editor.tags(), allFrames = editor.frames();
    if (previous !== editor) { previous = editor; selected = ""; signature = ""; element.open = false; }
    if (selected && !tags.some(tag => tag.id === selected)) selected = "";
    const focused = document.activeElement;
    const disabled = options.disabled(), tag = tags.find(value => value.id === selected);
    const next = JSON.stringify([tags, allFrames, selected, editor.initialTag(), disabled]);
    if (signature === next) return; signature = next;
    const choices = [{ id: "", label: uiMessage("All Frames") }, ...tags.map(tag => ({ id: tag.id, label: tag.name + " · Clip " + tag.clipId }))];
    select.replaceChildren(...choices.map(choice => { const option = document.createElement("option"); option.value = choice.id; setUiText(option, choice.label); return option; }));
    select.value = selected; select.disabled = disabled;
    name.value = tag?.name ?? ""; name.disabled = loop.disabled = disabled || !tag;
    loop.checked = tag?.loop ?? true;
    buttons.get("add")!.disabled = disabled || tags.length >= PIXEL_LIMITS.tags;
    buttons.get("remove")!.disabled = disabled || !tag || tags.length < 2;
    const initial = buttons.get("initial")!; initial.disabled = disabled || !tag || tag.id === editor.initialTag();
    initial.setAttribute("aria-pressed", String(!!tag && tag.id === editor.initialTag()));
    for (const [id, row] of rows) if (!allFrames.some(frame => frame.id === id)) { row.label.remove(); rows.delete(id); }
    for (const [index, frame] of allFrames.entries()) {
      let row = rows.get(frame.id);
      if (!row) {
        const label = document.createElement("label"), input = document.createElement("input"), text = document.createElement("span");
        input.type = "checkbox"; input.dataset.pixelTagFrame = frame.id; label.append(input, text); row = { label, input, text }; rows.set(frame.id, row);
        input.onchange = () => perform(() => {
          const tag = current(); if (!tag) return;
          update({ frameIds: input.checked ? [...tag.frameIds, frame.id] : tag.frameIds.filter(id => id !== frame.id) });
        });
      }
      row.input.checked = tag?.frameIds.includes(frame.id) ?? false; row.input.disabled = disabled || !tag;
      row.text.textContent = String(index + 1) + " · " + frame.durationMs + " ms" + (tag?.frameIds.includes(frame.id) ? " · #" + (tag.frameIds.indexOf(frame.id) + 1) : "");
      if (frames.children[index] !== row.label) frames.insertBefore(row.label, frames.children[index] ?? null);
    }
    if (focused instanceof HTMLButtonElement && panel.contains(focused) && focused.disabled && !select.disabled) select.focus({preventScroll:true});
  }
  return { element, sync,
    previewFrames() {
      const all = options.editor().frames(), tag = current();
      return tag ? tag.frameIds.map(id => all.find(frame => frame.id === id)!) : all;
    },
    previewLoop: () => current()?.loop ?? true,
    clear() { selected = ""; previous = undefined; signature = ""; rows.clear(); frames.replaceChildren(); element.open = false; },
  };
}
