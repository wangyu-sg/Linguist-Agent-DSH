import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_DATA_ROOT = join(
  platform() === 'darwin' ? join(homedir(), 'Library/Application Support')
    : platform() === 'win32' ? process.env.LOCALAPPDATA ?? join(homedir(), 'AppData/Local')
      : process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share'),
  'Linguist-Agent-DSH',
)

export function initializeStorage(config: { dataRoot: string; installationId: string }): { dataRoot: string; installationId: string } {
  const dataRoot = config.dataRoot || DEFAULT_DATA_ROOT
  mkdirSync(dataRoot, { recursive: true, mode: 0o700 })
  if (config.installationId) return { dataRoot, installationId: config.installationId }
  const path = join(dataRoot, 'installation-id')
  if (existsSync(path)) return { dataRoot, installationId: readFileSync(path, 'utf8').trim() }
  const installationId = randomUUID()
  writeFileSync(path, `${installationId}\n`, { flag: 'wx', mode: 0o600 })
  return { dataRoot, installationId }
}
