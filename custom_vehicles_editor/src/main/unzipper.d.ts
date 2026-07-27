declare module 'unzipper' {
  import type { Readable } from 'node:stream'

  export interface FileEntry {
    path: string
    type: 'File' | 'Directory'
    versionMadeBy: number
    flags: number
    compressionMethod: number
    crc32: number
    compressedSize: number
    uncompressedSize: number
    externalFileAttributes: number
    stream(password?: string): Readable
    buffer(password?: string): Promise<Buffer>
  }

  export interface Directory {
    files: FileEntry[]
  }

  export const Open: {
    file(path: string, options?: { tailSize?: number }): Promise<Directory>
  }
}
