export interface TextureRegistryEntry {
  name: string;
  textureId: number;
  url: string;
}

export class TextureRegistry {
  private readonly idsByName = new Map<string, number>();
  private readonly entriesById = new Map<number, TextureRegistryEntry>();
  private nextTextureId = 1;

  reserve(name: string, url: string): number {
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
      throw new Error(`Texture '${name}' is not registered. Check the textures manifest passed to loadAssets().`);
    }
    return textureId;
  }

  tryTextureId(name: string): number | undefined {
    return this.idsByName.get(name);
  }

  entries(): TextureRegistryEntry[] {
    return [...this.entriesById.values()];
  }
}
