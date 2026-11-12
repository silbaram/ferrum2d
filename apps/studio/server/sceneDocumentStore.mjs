import { open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

const pending = new Map();

function validate(document) {
  if (!document || document.format !== "ferrum2d.consumer.scene-authoring"
    || document.version !== 1
    || !document.sceneComposition || typeof document.sceneComposition !== "object"
    || Array.isArray(document.sceneComposition)) {
    throw new Error("invalid placement scene document");
  }
}

/** Serialize this host's writes. Independent external writers are checked before replacement. */
export async function savePlacementDocument(file, document, expectedDocument) {
  validate(document);
  validate(expectedDocument);
  const previous = pending.get(file) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(async () => {
    const check = async () => {
      if (!isDeepStrictEqual(JSON.parse(await readFile(file, "utf8")), expectedDocument)) {
        const error = new Error("Scene document changed on disk; reload before saving.");
        error.code = "PLACEMENT_DOCUMENT_CONFLICT";
        throw error;
      }
    };
    await check();
    const permissions = (await stat(file)).mode;
    const temporary = join(dirname(file), `.ferrum-scene-save-${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx");
    try {
      await handle.chmod(permissions);
      await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      await check();
      await rename(temporary, file);
      return { saved: true, document };
    } finally {
      await handle.close().catch(() => {});
      await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
  });
  pending.set(file, result);
  try {
    return await result;
  } finally {
    if (pending.get(file) === result) pending.delete(file);
  }
}
