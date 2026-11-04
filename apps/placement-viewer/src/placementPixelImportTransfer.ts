/** Read only the files explicitly provided by this paste/drop event. Never fetch URLs. */
export function pixelImportTransferFile(files: ArrayLike<File>): File {
  if (!files.length) throw Error("Copy the image itself, then paste here.");
  if (files.length !== 1) throw Error("Import one PNG image at a time.");
  const file = files[0];
  if (file.type.toLowerCase() !== "image/png" && !/\.png$/i.test(file.name))
    throw Error("Only PNG images can be imported.");
  return file; // The existing importer validates bytes and dimensions before decoding.
}

/** DOM input routing only; conversion and document replacement belong to the importer/host. */
export function installPixelImportTransfer(options: {
  roots: readonly HTMLElement[];
  disabled(): boolean;
  open(file: File): void;
  report(error: unknown): void;
}) {
  const lifetime = new AbortController();
  const clear = () => { for (const root of options.roots) delete root.dataset.pixelImageDrop; };
  const visible = (root: HTMLElement) => root.isConnected && !root.closest("[hidden],[inert]") && root.getClientRects().length > 0;
  const blocked = () => options.disabled() || !!document.querySelector("dialog[open]");
  const filesDragged = (data: DataTransfer | null) => data?.types.includes("Files") === true;
  const consume = (event: Event) => { event.preventDefault(); event.stopPropagation(); };
  function importFiles(files: ArrayLike<File>) {
    try {
      if (blocked()) throw Error("Finish editing or return to an editable scene before importing.");
      options.open(pixelImportTransferFile(files));
    } catch (error) { options.report(error); }
  }
  for (const root of options.roots) {
    root.addEventListener("paste", event => {
      if (!visible(root) || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest("input,textarea,select,[contenteditable]:not([contenteditable=false])")) return;
      consume(event);
      clear();
      // FileList is only readable during the paste/drop event, so consume it synchronously.
      importFiles(event.clipboardData?.files ?? []);
    }, { signal: lifetime.signal });
    const dragOver = (event: DragEvent) => {
      if (!visible(root) || !filesDragged(event.dataTransfer)) return;
      consume(event);
      const disabled = blocked();
      if (event.dataTransfer) event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      if (disabled) clear();
      else root.dataset.pixelImageDrop = "true";
    };
    root.addEventListener("dragenter", dragOver, { signal: lifetime.signal });
    root.addEventListener("dragover", dragOver, { signal: lifetime.signal });
    root.addEventListener("dragleave", event => {
      if (!(event.relatedTarget instanceof Node) || !root.contains(event.relatedTarget)) delete root.dataset.pixelImageDrop;
    }, { signal: lifetime.signal });
    root.addEventListener("drop", event => {
      clear();
      if (!visible(root) || !filesDragged(event.dataTransfer)) return;
      consume(event); // Prevent browser navigation even when validation rejects the file.
      importFiles(event.dataTransfer!.files);
    }, { signal: lifetime.signal });
  }
  // The top-layer import dialog lives outside both roots. A file dropped on it
  // must not navigate away from the document or replace the preview in progress.
  const guardDialog = (event: DragEvent) => {
    if (filesDragged(event.dataTransfer) && event.target instanceof Element &&
      event.target.closest('[data-pixel-import-dialog][open]')) { consume(event); clear(); }
  };
  document.addEventListener("dragover", guardDialog, { signal: lifetime.signal });
  document.addEventListener("drop", guardDialog, { signal: lifetime.signal });
  window.addEventListener("dragend", clear, { signal: lifetime.signal });
  window.addEventListener("blur", clear, { signal: lifetime.signal });
  return {
    clear,
    sync() {
      if (blocked()) clear();
      // Normal painting must not force a layout read for an inactive drop hint.
      else for (const root of options.roots) if (root.dataset.pixelImageDrop && !visible(root)) delete root.dataset.pixelImageDrop;
    },
    destroy() { lifetime.abort(); clear(); },
  };
}
