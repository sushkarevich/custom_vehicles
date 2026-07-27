import {
  NearestFilter,
  SRGBColorSpace,
  Texture
} from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { EditorApi } from '../../shared/ipc'
import {
  configureMinecraftTexture,
  PreviewTextureCache
} from './preview-texture-cache'

declare global {
  interface Window {
    editorApi: EditorApi
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason: unknown) => void = () => undefined
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('PreviewTextureCache', () => {
  it('настраивает Minecraft-текстуру для nearest sampling и sRGB', () => {
    const texture = new Texture()

    expect(configureMinecraftTexture(texture, 90)).toBe(texture)
    expect(texture.colorSpace).toBe(SRGBColorSpace)
    expect(texture.magFilter).toBe(NearestFilter)
    expect(texture.minFilter).toBe(NearestFilter)
    expect(texture.generateMipmaps).toBe(false)
    expect(texture.center.toArray()).toEqual([0.5, 0.5])
    expect(texture.rotation).toBeCloseTo(-Math.PI / 2)
    expect(texture.version).toBe(1)
  })

  it('дедуплицирует параллельную загрузку и освобождает texture после последней ссылки', async () => {
    const pending = deferred<Texture>()
    const loader = vi.fn(() => pending.promise)
    const cache = new PreviewTextureCache(loader)
    const texture = new Texture()
    const dispose = vi.spyOn(texture, 'dispose')

    const first = cache.acquire('rp_stone', 90)
    const second = cache.acquire('rp_stone', 90)

    expect(first).toBe(second)
    expect(loader).toHaveBeenCalledOnce()
    expect(loader).toHaveBeenCalledWith('rp_stone', 90)
    expect(cache.size).toBe(1)

    cache.release('rp_stone', 90)
    pending.resolve(texture)
    await expect(first).resolves.toBe(texture)
    expect(dispose).not.toHaveBeenCalled()
    expect(cache.size).toBe(1)

    cache.release('rp_stone', 90)
    expect(dispose).toHaveBeenCalledOnce()
    expect(cache.size).toBe(0)
  })

  it('освобождает завершившуюся позже загрузку без ссылок и удаляет failed entry', async () => {
    const pendingTexture = deferred<Texture>()
    const pendingFailure = deferred<Texture>()
    const texture = new Texture()
    const dispose = vi.spyOn(texture, 'dispose')
    const loader = vi
      .fn()
      .mockReturnValueOnce(pendingTexture.promise)
      .mockReturnValueOnce(pendingFailure.promise)
    const cache = new PreviewTextureCache(loader)

    const abandoned = cache.acquire('rp_abandoned')
    cache.release('rp_abandoned')
    pendingTexture.resolve(texture)
    await expect(abandoned).resolves.toBe(texture)
    expect(dispose).toHaveBeenCalledOnce()
    expect(cache.size).toBe(0)

    const failed = cache.acquire('rp_failed')
    pendingFailure.reject(new Error('decode failed'))
    await expect(failed).rejects.toThrow('decode failed')
    expect(cache.size).toBe(0)
  })

  it('не смешивает cache entries с разным поворотом и очищает каждую ровно один раз', async () => {
    const zero = new Texture()
    const rotated = new Texture()
    const disposeZero = vi.spyOn(zero, 'dispose')
    const disposeRotated = vi.spyOn(rotated, 'dispose')
    const loader = vi
      .fn()
      .mockResolvedValueOnce(zero)
      .mockResolvedValueOnce(rotated)
    const cache = new PreviewTextureCache(loader)

    await Promise.all([
      cache.acquire('rp_log', 0),
      cache.acquire('rp_log', 180)
    ])
    expect(loader).toHaveBeenCalledTimes(2)
    expect(cache.size).toBe(2)

    cache.clear()
    cache.clear()
    expect(disposeZero).toHaveBeenCalledOnce()
    expect(disposeRotated).toHaveBeenCalledOnce()
    expect(cache.size).toBe(0)
  })
})
