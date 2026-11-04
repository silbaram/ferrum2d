/** Browser clipboard access only. Call from an explicit copy action; never read the clipboard. */
export function pixelClipboardUnavailable(): string | undefined {
  if (!globalThis.isSecureContext || typeof ClipboardItem === "undefined" || typeof navigator.clipboard?.write !== "function" ||
    (typeof ClipboardItem.supports === "function" && !ClipboardItem.supports("image/png")))
    return "Image clipboard unavailable. Use Export PNG.";
  return undefined;
}

/** Start write before awaiting PNG encoding, preserving the click's user activation. */
export function copyPixelPng(encode: () => Promise<ArrayBuffer>, signal: AbortSignal): Promise<void> {
  const unavailable = pixelClipboardUnavailable();
  if (unavailable) return Promise.reject(Error(unavailable));
  if (signal.aborted) return Promise.reject(signal.reason);
  const data = Promise.resolve().then(() => { signal.throwIfAborted(); return encode(); }).then(bytes => {
    signal.throwIfAborted();
    return new Blob([bytes], { type: "image/png" });
  });
  // Constructors/permissions can reject without ever consuming the PNG promise.
  void data.catch(() => {});
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true; signal.removeEventListener("abort", abort);
      if (error !== undefined) reject(error); else resolve();
    };
    const abort = () => finish(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    try {
      const write = navigator.clipboard.write([new ClipboardItem({ "image/png": data })]);
      void write.then(() => finish(), error => finish(signal.aborted ? signal.reason : Error(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Image copy was blocked. Allow clipboard access or use Export PNG."
          : "Image copy failed. Use Export PNG.")));
    } catch { finish(Error("Image copy failed. Use Export PNG.")); }
  });
}
