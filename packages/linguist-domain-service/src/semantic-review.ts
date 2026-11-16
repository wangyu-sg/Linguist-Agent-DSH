import { execFile } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { Segment } from '@linguist/cat-core'

export type ReviewSegment = Pick<Segment, 'id' | 'ordinal' | 'key' | 'source' | 'target' | 'locked' | 'context'> & Partial<Pick<Segment, 'revision' | 'assetId'>>

export type SemanticReview =
  | { status: 'pending' }
  | { status: 'disabled' }
  | { status: 'failed'; error: string }
  | { status: 'ready'; model: string; fingerprint: string; embedded: number; cached: number; reusedGroups: boolean;
      groups: Array<{ anchorId: string; segmentIds: string[] }> }

/** Reuse the installed MemSearch Python environment, without changing its plugin or memory index. */
export async function getSemanticReview(cachePath: string, segments: readonly Pick<ReviewSegment, 'id' | 'source'>[], signal: AbortSignal): Promise<SemanticReview> {
  try {
    const texts = [...new Set(segments.map(segment => segment.source).filter(text => text.trim()))]
    const stdout = await runSemantic({ cachePath, texts }, signal)
    const result = z.object({
      model: z.literal('gpahal/bge-m3-onnx-int8'), fingerprint: z.string().min(1), texts: z.array(z.string()),
      groups: z.array(z.object({ anchor: z.number().int().nonnegative(), members: z.array(z.number().int().nonnegative()).min(2) })),
      embedded: z.number().int().nonnegative(), cached: z.number().int().nonnegative(), reusedGroups: z.boolean(),
    }).parse(JSON.parse(stdout))
    if (result.texts.length !== texts.length || new Set(result.texts).size !== texts.length || result.texts.some(text => !texts.includes(text))) throw new Error('语义检索返回的原文范围不一致')
    const byText = new Map<string, string[]>()
    for (const segment of segments) byText.set(segment.source, [...(byText.get(segment.source) ?? []), segment.id])
    const groups = result.groups.map(group => {
      if (!group.members.includes(group.anchor) || new Set(group.members).size !== group.members.length
        || group.members.some(i => i >= result.texts.length)) throw new Error('语义检索返回了范围外的句段')
      return { anchorId: byText.get(result.texts[group.anchor]!)![0]!, segmentIds: group.members.flatMap(i => byText.get(result.texts[i]!)!) }
    })
    return { status: 'ready', model: result.model, fingerprint: result.fingerprint, groups,
      embedded: result.embedded, cached: result.cached, reusedGroups: result.reusedGroups }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}

async function runSemantic(request: object, signal: AbortSignal): Promise<string> {
  const paths = [...(process.env.PATH ?? '').split(delimiter), join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin']
  const entry = paths.map(path => join(path, 'memsearch')).find(existsSync)
  if (!entry) throw new Error('需要本机 MemSearch ONNX 环境与已缓存的 BGE-M3 INT8 模型；未运行语义检索')
  const python = join(dirname(realpathSync(entry)), 'python')
  if (!existsSync(python)) throw new Error('MemSearch 安装目录没有 Python 解释器；未运行语义检索')
  return new Promise<string>((resolve, reject) => {
    const child = execFile(python, [fileURLToPath(new URL('./semantic-review.py', import.meta.url))], {
      signal, timeout: 300_000, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1' },
    }, (error, stdout, stderr) => error ? reject(new Error(`本地语义检索失败：${stderr.trim() || error.message}`)) : resolve(stdout))
    child.stdin!.on('error', reject)
    child.stdin!.end(JSON.stringify(request))
  })
}

export async function checkSemanticModel(): Promise<{ available: boolean; model: string; error?: string }> {
  try {
    const result = z.object({ model: z.string(), fingerprint: z.string() }).parse(JSON.parse(await runSemantic({ action: 'status' }, new AbortController().signal)))
    return { available: true, model: result.model }
  } catch (error) { return { available: false, model: 'gpahal/bge-m3-onnx-int8', error: error instanceof Error ? error.message : String(error) } }
}
