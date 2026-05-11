export interface SoundRegistryEntry {
  name: string;
  soundId: number;
  url: string;
}

export class SoundRegistry {
  private readonly idsByName = new Map<string, number>();
  private readonly entriesById = new Map<number, SoundRegistryEntry>();
  private nextSoundId = 1;

  reserve(name: string, url: string): number {
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
      throw new Error(`Sound '${name}' is not registered. Check the sounds manifest passed to loadAssets().`);
    }
    return soundId;
  }

  trySoundId(name: string): number | undefined {
    return this.idsByName.get(name);
  }

  entries(): SoundRegistryEntry[] {
    return [...this.entriesById.values()];
  }
}
