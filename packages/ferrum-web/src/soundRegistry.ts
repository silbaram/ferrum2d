import { copyResourceRegistry } from "./nativeFileResourceRegistries.js";
import { NativeFileResourceError } from "./nativeFileResourceBudget.js";
import { registerRegistryFileOwner } from "./nativeFileResourceOwners.js";
import { resourceInteger, resourceString } from "./nativeFileResourceBudget.js";
import { assetLookupError } from "./diagnostics.js";

export interface SoundRegistryEntry {
  name: string;
  soundId: number;
  url: string;
}

export class SoundRegistry {
  private idsByName = new Map<string, number>();
  private entriesById = new Map<number, SoundRegistryEntry>();
  private nextSoundId = 1;
  private fileRevision = 0;

  constructor() {
    registerRegistryFileOwner(this, { capture: budget => {
      budget.work(this.entriesById.size + this.idsByName.size + 1);
      budget.charge("resources", this.entriesById.size);
      const nextId = resourceInteger(this.nextSoundId, "registry next id", 1, Number.MAX_SAFE_INTEGER);
      if (this.entriesById.size !== this.idsByName.size || this.entriesById.size !== nextId - 1) budget.fail("DATA", "registry cardinality");
      const entries = [];
      let ordinal = 0;
      for (const [id, entry] of this.entriesById) {
        resourceInteger(id, "registry id", 1, nextId - 1);
        if (id !== ++ordinal) budget.fail("DATA", "registry producer order");
        const fields = ["name", "url", "soundId"].map(key => Object.getOwnPropertyDescriptor(entry, key));
        if (fields.some(d => !d || !("value" in d))) budget.fail("DATA", "registry data properties");
        const name = resourceString(fields[0]?.value, "registry name"), url = resourceString(fields[1]?.value, "registry URL"), storedId: unknown = fields[2]?.value;
        if (storedId !== id || this.idsByName.get(name) !== id) budget.fail("DATA", "registry binding");
        budget.metadata(name); budget.metadata(url);
        entries.push(Object.freeze({ id, name, url }));
      }
      return Object.freeze({ kind: "sound" as const, nextId, entries: Object.freeze(entries) });
    },
      revision: () => this.fileRevision,
      prepare: (input,budget) => {
        const data = copyResourceRegistry(input,"sound",budget), revision = this.fileRevision;
        const ids = new Map<string,number>(), entries = new Map<number,SoundRegistryEntry>();
        for(const row of data.entries){ids.set(row.name,row.id);entries.set(row.id,{name:row.name,soundId:row.id,url:row.url});}
        let disposed=false,adopted=false;
        const assertCurrent=()=>{if(disposed||adopted||revision!==this.fileRevision)throw new NativeFileResourceError("STALE","registry adoption");};
        return Object.freeze({assertCurrent,adopt:()=>{assertCurrent();this.idsByName=ids;this.entriesById=entries;this.nextSoundId=data.nextId;this.fileRevision++;adopted=true;},
          dispose:()=>{if(!adopted){disposed=true;ids.clear();entries.clear();}}});
      },
    });
  }

  reserve(name: string, url: string): number {
    this.fileRevision++;
    const existing = this.idsByName.get(name);
    if (existing !== undefined) {
      this.entriesById.set(existing, { name, soundId: existing, url });
      return existing;
    }

    const soundId = this.nextSoundId;
    this.nextSoundId += 1;
    this.idsByName.set(name, soundId);
    this.entriesById.set(soundId, { name, soundId, url });
    return soundId;
  }

  soundId(name: string): number {
    const soundId = this.trySoundId(name);
    if (soundId === undefined) {
      throw assetLookupError({
        kind: "sound",
        name,
        detail: "Sound is not registered. Check the sounds manifest passed to loadAssets().",
      });
    }
    return soundId;
  }

  trySoundId(name: string): number | undefined {
    return this.idsByName.get(name);
  }

  tryEntry(name: string): SoundRegistryEntry | undefined {
    const soundId = this.trySoundId(name);
    return soundId === undefined ? undefined : this.entriesById.get(soundId);
  }

  entries(): SoundRegistryEntry[] {
    return [...this.entriesById.values()];
  }
}
