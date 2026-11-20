import { copyResourceRegistry } from "./nativeFileResourceRegistries.js";
import { NativeFileResourceError } from "./nativeFileResourceBudget.js";
import { registerRegistryFileOwner } from "./nativeFileResourceOwners.js";
import { resourceInteger, resourceString } from "./nativeFileResourceBudget.js";
import { assetLookupError } from "./diagnostics.js";

export interface TextureRegistryEntry {
  name: string;
  textureId: number;
  url: string;
}

export class TextureRegistry {
  private idsByName = new Map<string, number>();
  private entriesById = new Map<number, TextureRegistryEntry>();
  private nextTextureId = 1;
  private fileRevision = 0;

  constructor() {
    registerRegistryFileOwner(this, { capture: budget => {
      budget.work(this.entriesById.size + this.idsByName.size + 1);
      budget.charge("resources", this.entriesById.size);
      const nextId = resourceInteger(this.nextTextureId, "registry next id", 1, Number.MAX_SAFE_INTEGER);
      if (this.entriesById.size !== this.idsByName.size || this.entriesById.size !== nextId - 1) budget.fail("DATA", "registry cardinality");
      const entries = [];
      let ordinal = 0;
      for (const [id, entry] of this.entriesById) {
        resourceInteger(id, "registry id", 1, nextId - 1);
        if (id !== ++ordinal) budget.fail("DATA", "registry producer order");
        const fields = ["name", "url", "textureId"].map(key => Object.getOwnPropertyDescriptor(entry, key));
        if (fields.some(d => !d || !("value" in d))) budget.fail("DATA", "registry data properties");
        const name = resourceString(fields[0]?.value, "registry name"), url = resourceString(fields[1]?.value, "registry URL"), storedId: unknown = fields[2]?.value;
        if (storedId !== id || this.idsByName.get(name) !== id) budget.fail("DATA", "registry binding");
        budget.metadata(name); budget.metadata(url);
        entries.push(Object.freeze({ id, name, url }));
      }
      return Object.freeze({ kind: "texture" as const, nextId, entries: Object.freeze(entries) });
    },
      revision: () => this.fileRevision,
      prepare: (input,budget) => {
        const data = copyResourceRegistry(input,"texture",budget), revision = this.fileRevision;
        const ids = new Map<string,number>(), entries = new Map<number,TextureRegistryEntry>();
        for(const row of data.entries){ids.set(row.name,row.id);entries.set(row.id,{name:row.name,textureId:row.id,url:row.url});}
        let disposed=false,adopted=false;
        const assertCurrent=()=>{if(disposed||adopted||revision!==this.fileRevision)throw new NativeFileResourceError("STALE","registry adoption");};
        return Object.freeze({assertCurrent,adopt:()=>{assertCurrent();this.idsByName=ids;this.entriesById=entries;this.nextTextureId=data.nextId;this.fileRevision++;adopted=true;},
          dispose:()=>{if(!adopted){disposed=true;ids.clear();entries.clear();}}});
      },
    });
  }

  reserve(name: string, url: string): number {
    this.fileRevision++;
    const existing = this.idsByName.get(name);
    if (existing !== undefined) {
      this.entriesById.set(existing, { name, textureId: existing, url });
      return existing;
    }

    const textureId = this.nextTextureId;
    this.nextTextureId += 1;
    this.idsByName.set(name, textureId);
    this.entriesById.set(textureId, { name, textureId, url });
    return textureId;
  }

  textureId(name: string): number {
    const textureId = this.tryTextureId(name);
    if (textureId === undefined) {
      throw assetLookupError({
        kind: "texture",
        name,
        detail: "Texture is not registered. Check the textures manifest passed to loadAssets().",
      });
    }
    return textureId;
  }

  tryTextureId(name: string): number | undefined {
    return this.idsByName.get(name);
  }

  tryEntry(name: string): TextureRegistryEntry | undefined {
    const textureId = this.tryTextureId(name);
    return textureId === undefined ? undefined : this.entriesById.get(textureId);
  }

  entries(): TextureRegistryEntry[] {
    return [...this.entriesById.values()];
  }
}
