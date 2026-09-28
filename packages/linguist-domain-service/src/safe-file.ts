import { randomUUID } from 'node:crypto'
import { closeSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

export function writeJsonFileAtomic(filePath: string, data: object): void {
  const temporary = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`)
  let descriptor: number | undefined
  try {
    descriptor = openSync(temporary, 'wx', 0o600)
    writeFileSync(descriptor, JSON.stringify(data, null, 2), 'utf8')
    closeSync(descriptor)
    descriptor = undefined
    renameSync(temporary, filePath)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    rmSync(temporary, { force: true })
  }
}
