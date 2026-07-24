import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat
} from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, normalize } from 'node:path'

const MAX_DOCUMENT_BYTES = 1_048_576

export interface AtomicFileOperations {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>
  writeAndSync(path: string, content: string): Promise<void>
  replace(source: string, destination: string): Promise<void>
  remove(path: string): Promise<void>
}

const nativeOperations: AtomicFileOperations = {
  mkdir,
  async writeAndSync(path, content) {
    const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
  },
  replace: rename,
  async remove(path) {
    await rm(path, { force: true })
  }
}

export function ensureYamlExtension(filePath: string): string {
  const extension = extname(filePath).toLocaleLowerCase('en-US')
  return extension === '.yaml' || extension === '.yml' ? filePath : `${filePath}.yaml`
}

export function assertAbsoluteDocumentPath(filePath: string): string {
  if (!isAbsolute(filePath)) {
    throw new Error('Путь к документу должен быть абсолютным')
  }
  const normalized = normalize(filePath)
  const extension = extname(normalized).toLocaleLowerCase('en-US')
  if (extension !== '.yaml' && extension !== '.yml') {
    throw new Error('Поддерживаются только файлы .yaml и .yml')
  }
  return normalized
}

export async function readDocumentFile(filePath: string): Promise<string> {
  const safePath = assertAbsoluteDocumentPath(filePath)
  const info = await stat(safePath)
  if (!info.isFile()) throw new Error('Выбранный путь не является файлом')
  if (info.size > MAX_DOCUMENT_BYTES) throw new Error('Файл слишком большой для редактора')
  return readFile(safePath, 'utf8')
}

export async function writeFileAtomically(
  filePath: string,
  content: string,
  operations: AtomicFileOperations = nativeOperations,
  createId: () => string = randomUUID
): Promise<void> {
  const safePath = assertAbsoluteDocumentPath(filePath)
  if (Buffer.byteLength(content, 'utf8') > MAX_DOCUMENT_BYTES) {
    throw new Error('Документ слишком большой для сохранения')
  }
  await operations.mkdir(dirname(safePath), { recursive: true })
  const temporaryPath = join(dirname(safePath), `.${basename(safePath)}.${createId()}.tmp`)
  try {
    await operations.writeAndSync(temporaryPath, content)
    await operations.replace(temporaryPath, safePath)
  } catch (caught) {
    await operations.remove(temporaryPath).catch(() => undefined)
    throw caught
  }
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}
