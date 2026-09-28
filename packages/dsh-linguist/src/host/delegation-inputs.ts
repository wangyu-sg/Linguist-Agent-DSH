import { createHash } from 'node:crypto'
import { constants, copyFileSync, createReadStream, lstatSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface DelegationInput {
  path: string
  purpose: string
  required: boolean
  expectedSha256?: string
  snapshot?: boolean
}

export interface DelegationInputReceipt {
  requestedPath: string
  purpose: string
  state: 'referenced' | 'snapshotted' | 'missing' | 'blocked-input'
  usablePath?: string
  sha256?: string
  reason?: string
}

function inside(candidate: string, root: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/** Resolve against the real DSH Session cwd; requested paths never authorize themselves. */
export async function preflightDelegationInputs(
  inputs: readonly DelegationInput[],
  workspaceRoot: string,
): Promise<{ ready: boolean; items: Array<{ receipt: DelegationInputReceipt; sourcePath?: string; snapshot?: boolean }> }> {
  const root = realpathSync(workspaceRoot)
  const items: Array<{ receipt: DelegationInputReceipt; sourcePath?: string; snapshot?: boolean }> = []
  for (const input of inputs) {
    const requestedPath = input.path
    const blocked = (reason: string): { receipt: DelegationInputReceipt } => ({ receipt: { requestedPath, purpose: input.purpose, state: 'blocked-input', reason } })
    if (!requestedPath || isAbsolute(requestedPath) || requestedPath.split(/[\\/]/u).includes('..')) {
      items.push(blocked('Input path must be relative to the DSH Workspace'))
      continue
    }
    if (input.expectedSha256 !== undefined && !/^[a-f0-9]{64}$/i.test(input.expectedSha256)) {
      items.push(blocked('expectedSha256 must be a 64-character SHA-256'))
      continue
    }
    let sourcePath: string
    try {
      sourcePath = realpathSync(resolve(root, requestedPath))
      if (!inside(sourcePath, root) || !statSync(sourcePath).isFile()) throw new Error('Input is outside the Workspace or is not a regular file')
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      items.push(missing && input.required === false
        ? { receipt: { requestedPath, purpose: input.purpose, state: 'missing', reason: 'Optional input is absent' } }
        : blocked(missing ? 'Required input is absent' : 'Input is unavailable or outside the Workspace'))
      continue
    }
    const snapshot = input.snapshot === true || input.expectedSha256 !== undefined
    const hash = snapshot ? await sha256(sourcePath) : undefined
    if (input.expectedSha256 !== undefined && hash !== input.expectedSha256.toLowerCase()) {
      items.push(blocked('Input SHA-256 differs from expectedSha256'))
      continue
    }
    items.push({ receipt: {
      requestedPath, purpose: input.purpose, state: snapshot ? 'snapshotted' : 'referenced',
      ...(snapshot ? {} : { usablePath: sourcePath }),
      ...(hash ? { sha256: hash } : {}),
    }, sourcePath, snapshot })
  }
  return { ready: items.every(item => item.receipt.state !== 'blocked-input'), items }
}

/** Copies only preflighted bytes into the same authorized Workspace before native delegation. */
export async function deliverDelegationInputs(
  items: readonly { receipt: DelegationInputReceipt; sourcePath?: string; snapshot?: boolean }[],
  workspaceRoot: string,
  callId: string,
): Promise<DelegationInputReceipt[]> {
  const root = realpathSync(workspaceRoot)
  const callDirectory = createHash('sha256').update(callId).digest('hex')
  const targetRoot = join(root, '.linguist', 'delegation-inputs', callDirectory)
  const receipts: DelegationInputReceipt[] = []
  for (const [index, item] of items.entries()) {
    if (!item.snapshot || !item.sourcePath) { receipts.push(item.receipt); continue }
    let directory = root
    for (const component of ['.linguist', 'delegation-inputs', callDirectory]) {
      directory = join(directory, component)
      mkdirSync(directory, { mode: 0o700, recursive: true })
      const info = lstatSync(directory)
      if (info.isSymbolicLink() || !info.isDirectory() || !inside(realpathSync(directory), root)) {
        throw new Error('Delegation input directory is not a regular Workspace directory')
      }
    }
    const target = join(targetRoot, `${index + 1}-${basename(item.sourcePath)}`)
    copyFileSync(item.sourcePath, target, constants.COPYFILE_EXCL)
    if (await sha256(target) !== item.receipt.sha256) throw new Error(`Input changed during delivery: ${item.receipt.requestedPath}`)
    receipts.push({ ...item.receipt, usablePath: target })
  }
  return receipts
}
