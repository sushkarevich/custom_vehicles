// @vitest-environment node

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertAbsoluteDocumentPath,
  ensureYamlExtension,
  type AtomicFileOperations,
  writeFileAtomically
} from './file-system'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('безопасные пути и атомарное сохранение', () => {
  it('обрабатывает пробелы и кириллицу в абсолютном пути', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'Редактор машин '))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'модель метро 717.yaml')
    expect(assertAbsoluteDocumentPath(filePath)).toBe(filePath)
    await writeFileAtomically(filePath, 'schema-version: 1\n')
    expect(await readFile(filePath, 'utf8')).toBe('schema-version: 1\n')
  })

  it('добавляет расширение только при необходимости', () => {
    expect(ensureYamlExtension('/tmp/моя модель')).toBe('/tmp/моя модель.yaml')
    expect(ensureYamlExtension('/tmp/model.YML')).toBe('/tmp/model.YML')
    expect(() => assertAbsoluteDocumentPath('relative.yaml')).toThrow('абсолютным')
  })

  it('пишет временный файл, синхронизирует и заменяет назначение', async () => {
    const events: string[] = []
    const operations: AtomicFileOperations = {
      mkdir: vi.fn(async () => {
        events.push('mkdir')
      }),
      writeAndSync: vi.fn(async () => {
        events.push('writeAndSync')
      }),
      replace: vi.fn(async () => {
        events.push('replace')
      }),
      remove: vi.fn(async () => {
        events.push('remove')
      })
    }
    await writeFileAtomically('/tmp/модель с пробелом.yaml', 'данные', operations, () => 'fixed')
    expect(events).toEqual(['mkdir', 'writeAndSync', 'replace'])
    expect(operations.writeAndSync).toHaveBeenCalledWith(
      '/tmp/.модель с пробелом.yaml.fixed.tmp',
      'данные'
    )
  })

  it('удаляет временный файл при ошибке замены', async () => {
    const operations: AtomicFileOperations = {
      mkdir: async () => undefined,
      writeAndSync: async () => undefined,
      replace: async () => {
        throw new Error('ошибка диска')
      },
      remove: vi.fn(async () => undefined)
    }
    await expect(
      writeFileAtomically('/tmp/model.yaml', 'data', operations, () => 'fixed')
    ).rejects.toThrow('ошибка диска')
    expect(operations.remove).toHaveBeenCalledWith('/tmp/.model.yaml.fixed.tmp')
  })

  it('отклоняет документ больше общего лимита 1 МиБ до записи', async () => {
    const operations: AtomicFileOperations = {
      mkdir: vi.fn(async () => undefined),
      writeAndSync: vi.fn(async () => undefined),
      replace: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined)
    }
    await expect(
      writeFileAtomically('/tmp/oversized.yaml', 'я'.repeat(524_289), operations)
    ).rejects.toThrow('слишком большой')
    expect(operations.writeAndSync).not.toHaveBeenCalled()
  })
})
