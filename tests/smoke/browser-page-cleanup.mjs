/** Bound a stalled browser cleanup without replacing an earlier smoke failure. */
export async function closeSmokePage(page, timeoutMs, primaryFailure) {
  let timer;
  try {
    await Promise.race([
      page.close(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Browser page cleanup exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } catch (error) {
    if (primaryFailure === undefined) throw error;
    if (primaryFailure instanceof Error) {
      // Frozen errors must keep their original identity too.
      try { primaryFailure.cause ??= error; } catch { /* Preserve the primary failure. */ }
    }
  } finally {
    clearTimeout(timer);
  }
}
