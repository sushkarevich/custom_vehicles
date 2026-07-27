import { useEffect, useState } from 'react'
import {
  MathUtils,
  NearestFilter,
  SRGBColorSpace,
  TextureLoader,
  type Texture
} from 'three'

interface TextureEntry {
  references: number
  promise: Promise<Texture>
  texture: Texture | null
}

export type PreviewTextureLoader = (
  assetToken: string,
  rotation: 0 | 90 | 180 | 270
) => Promise<Texture>

export function configureMinecraftTexture(
  texture: Texture,
  rotation: 0 | 90 | 180 | 270 = 0
): Texture {
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.generateMipmaps = false
  texture.center.set(0.5, 0.5)
  texture.rotation = -MathUtils.degToRad(rotation)
  texture.needsUpdate = true
  return texture
}

async function loadPreviewTexture(
  assetToken: string,
  rotation: 0 | 90 | 180 | 270
): Promise<Texture> {
  const api = window.editorApi.resourcePreview
  if (api === undefined) throw new Error('API текстур недоступен')
  const bytes = await api.readAsset(assetToken)
  const copy = Uint8Array.from(bytes)
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: 'image/png' }))
  try {
    const texture = await new TextureLoader().loadAsync(url)
    return configureMinecraftTexture(texture, rotation)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Promise-aware reference-counted cache. R3F owns/disposes each material,
 * while this cache alone owns shared decoded texture objects.
 */
export class PreviewTextureCache {
  readonly #entries = new Map<string, TextureEntry>()
  readonly #loader: PreviewTextureLoader

  public constructor(loader: PreviewTextureLoader = loadPreviewTexture) {
    this.#loader = loader
  }

  public acquire(
    assetToken: string,
    rotation: 0 | 90 | 180 | 270 = 0
  ): Promise<Texture> {
    const key = `${assetToken}\u0000${rotation}`
    const current = this.#entries.get(key)
    if (current !== undefined) {
      current.references += 1
      return current.promise
    }
    const entry: TextureEntry = {
      references: 1,
      texture: null,
      promise: Promise.resolve(null as unknown as Texture)
    }
    entry.promise = this.#loader(assetToken, rotation).then(
      (texture) => {
        entry.texture = texture
        if (entry.references === 0) {
          texture.dispose()
          this.#entries.delete(key)
        }
        return texture
      },
      (error: unknown) => {
        this.#entries.delete(key)
        throw error
      }
    )
    this.#entries.set(key, entry)
    return entry.promise
  }

  public release(
    assetToken: string,
    rotation: 0 | 90 | 180 | 270 = 0
  ): void {
    const key = `${assetToken}\u0000${rotation}`
    const entry = this.#entries.get(key)
    if (entry === undefined) return
    entry.references = Math.max(0, entry.references - 1)
    if (entry.references === 0 && entry.texture !== null) {
      entry.texture.dispose()
      this.#entries.delete(key)
    }
  }

  public clear(): void {
    this.#entries.forEach((entry) => {
      entry.references = 0
      entry.texture?.dispose()
    })
    this.#entries.clear()
  }

  public get size(): number {
    return this.#entries.size
  }
}

export const previewTextureCache = new PreviewTextureCache()

export function usePreviewTexture(
  assetToken: string | null,
  rotation: 0 | 90 | 180 | 270 = 0
): Texture | null {
  const cacheKey = assetToken === null ? null : `${assetToken}\u0000${rotation}`
  const [loaded, setLoaded] = useState<{
    cacheKey: string
    texture: Texture
  } | null>(null)
  useEffect(() => {
    if (assetToken === null) return
    let active = true
    void previewTextureCache.acquire(assetToken, rotation).then(
      (loaded) => {
        if (active) {
          setLoaded({
            cacheKey: `${assetToken}\u0000${rotation}`,
            texture: loaded
          })
        }
      },
      () => undefined
    )
    return () => {
      active = false
      previewTextureCache.release(assetToken, rotation)
    }
  }, [assetToken, rotation])
  return loaded?.cacheKey === cacheKey ? loaded.texture : null
}
