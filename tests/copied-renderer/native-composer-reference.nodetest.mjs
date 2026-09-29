import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { catReferenceSource, connectCatReference } from '../../packages/dsh-linguist/src/client/composer-reference.ts'
import { publishWorkbenchComposerContext } from '../../packages/dsh-linguist/src/client/composer-context.ts'

// Peripheral host services are fixtures; the official input/editor implementation is unmodified.
const stores = {
  createSnapshotStore(value) {
    const listeners = new Set()
    return { getSnapshot: () => value, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
      set: next => { value = next; for (const fn of [...listeners]) fn() },
    }
  },
  defineStore: spec => ({ spec }),
}

const require = createRequire(new URL('../../packages/dsh-linguist/package.json', import.meta.url))
const bundle = readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-conversation/client'), 'utf8')

// The official public apply/input facade owns the real Lexical document and submit machine.
function nativeComposer() {
  let factory
  runInNewContext(bundle, { window: { __ModuleLoader__: { load: module => { factory = module.factory } } },
    AbortController, queueMicrotask, setTimeout, clearTimeout, requestAnimationFrame: fn => setTimeout(fn, 0), console, performance, crypto, URL, btoa,
    FileReader: class { readAsDataURL(file) { file.arrayBuffer().then(bytes => { this.result = `data:${file.type};base64,${Buffer.from(bytes).toString('base64')}`; this.onload() }) } },
  })
  class Service { constructor(ctx, name) { this.ctx = ctx; ctx[name] = this } }
  const official = factory(name => {
    if (name === '@deepseek-ai/cordis') return { Service }
    if (name === '@deepseek-ai/dsh-client-store') return stores
    if (name === '@deepseek-ai/dsh-client-ui-primitives' || name === '@deepseek-ai/dsh-client-ui-slots') return {}
    return require(name)
  })
  const disposers = []
  const events = new Map()
  const actx = {
    effect: setup => { const off = setup(); disposers.push(off); return off },
    on: (name, listener) => { events.set(name, listener); return () => events.delete(name) },
    bail: (name, value) => events.get(name)?.(value),
  }
  const sends = []
  let promptResult = { ok: true }
  const state = stores.createSnapshotStore({ blank: false, running: false, subagent: null, pendingSubmissions: [], promptError: null })
  const inbox = stores.createSnapshotStore({ 'next-turn': [], 'next-step': [] })
  const session = { sessionId: 'session-A', getSnapshot: state.getSnapshot, subscribe: state.subscribe,
    projections: { faceOf: key => key === 'inbox' ? inbox : stores.createSnapshotStore(undefined) },
    beginSubmission: input => {
      sends.push({ input })
      state.set({ ...state.getSnapshot(), pendingSubmissions: [{ requestId: 'real-native-request', text: input.text }] })
      return { requestId: 'real-native-request', abandon() {} }
    },
    prompt: async (content, mode, _signal, requestId) => { sends.at(-1).prompt = { content, mode, requestId }; return promptResult },
  }
  const binding = { sessionId: session.sessionId, session, ctx: actx }
  const ctx = {
    get(name) { return this[name] },
    sessions: { sessionOf: scope => scope === actx ? session : undefined, binding: () => binding, scope: () => actx },
    effect: actx.effect,
    inject() {},
    slots: { inject() {}, entries: () => [], subscribe: () => () => {} },
    locale: { register: () => () => {}, bind: () => key => key, subscribe: () => () => {} },
    configForms: { get() {}, developerTools: { enabled: stores.createSnapshotStore(false) } },
    uiSession: { provide() {} },
    plugin(Plugin, config) { if (Plugin === official.ConversationController) new Plugin(this, config) },
  }
  official.apply(ctx)
  const sources = new Map()
  const lexicon = stores.createSnapshotStore(new Map())
  ctx.inputTriggers = {
    registerSource: source => { sources.set(source.name, source); return () => sources.delete(source.name) },
    sessionOf: () => ({ lexicon, track() {}, adjudicate: () => ctx.arbitrate(), serializeReference: (source, ref, signal) => sources.get(source).codec.serialize(ref, signal) }),
  }
  const input = ctx.conversation.input.for(actx)
  return { ctx, actx, input, sends, failPrompt: () => { promptResult = { ok: false, error: { message: 'Synthetic admission rejection' } } },
    admit: () => {
      state.set({ ...state.getSnapshot(), pendingSubmissions: [] })
      sends.at(-1).input.onRetire?.({ reason: 'observed', attachments: [] })
    },
    dispose: () => { for (const off of disposers.reverse()) off?.() } }
}

test('official native input keeps ordinary text and reference identity through asynchronous serialization', async () => {
  const native = nativeComposer()
  try {
    let release
    native.ctx.inputTriggers.registerSource({ name: 'test', codec: { serialize: ref => new Promise(resolve => { release = () => resolve(`frozen:${ref}`) }) } })
    native.input.setDraft('Keep this draft')
    assert.equal(native.input.insertReference({ source: 'test', ref: 'A', label: 'A', clipboardText: '@A' }, { start: 0, end: 0, draftRev: native.input.state.getSnapshot().draftRev }), true)
    native.input.submit('steer')
    native.input.setDraft('Next draft')
    release()
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(native.sends[0].prompt.content[0].text, 'frozen:A Keep this draft')
    assert.equal(native.sends[0].prompt.mode, 'steer')
    assert.equal(native.sends[0].prompt.requestId, 'real-native-request')
    assert.equal(native.input.state.getSnapshot().draft, 'Next draft')
  } finally { native.dispose() }
})

const publish = (ids = ['segment-A']) => publishWorkbenchComposerContext('session-A', {
  projectId: 'project-A', projectName: 'Synthetic', selectedCount: ids.length,
  selection: { schemaVersion: 1, projectId: 'project-A', assetId: 'asset-A', selectedSegmentIds: ids, capturedAt: new Date().toISOString(), uiRevision: 1 },
  clearReference() {}, clearSelection() {},
})
const textOf = send => send.prompt.content.find(part => part.type === 'text').text
const contextOf = text => JSON.parse(text.match(/\[LA-TURN-CONTEXT v1\]\n([^\n]+)\n\[\/LA-TURN-CONTEXT\]/)[1])
const tick = () => new Promise(resolve => setTimeout(resolve, 30))

test('CAT reference captures synchronously, preserves another reference and image, and leaves a quickly typed next draft alone', async () => {
  const native = nativeComposer()
  let connected
  try {
    publish()
    native.input.setDraft('Original draft ')
    let releaseFile
    native.ctx.inputTriggers.registerSource({ name: 'file', codec: { serialize: () => new Promise(resolve => { releaseFile = () => resolve('original-file') }) } })
    native.input.insertReference({ source: 'file', ref: 'file-A', label: 'file-A', clipboardText: '@file-A' }, { start: 15, end: 15, draftRev: native.input.state.getSnapshot().draftRev })
    native.ctx.inputTriggers.registerSource(catReferenceSource)
    connected = connectCatReference(native.ctx, 'session-A', () => {})
    assert.equal(native.input.state.getSnapshot().occurrences.length, 1, 'connecting must not rewrite an existing draft')
    assert(connected.attach({ start: 17, end: 17, draftRev: native.input.state.getSnapshot().draftRev }))
    const image = native.ctx.conversation.createDrafts('session-A', [new File(['synthetic image bytes'], 'synthetic.png', { type: 'image/png' })])[0]
    native.input.addAttachments([image.id])
    native.input.submit('steer')
    publish(['segment-B'])
    native.input.setDraft('Next user draft')
    releaseFile()
    await tick()
    assert.equal(contextOf(textOf(native.sends[0])).context.selectedSegmentIds[0], 'segment-A')
    assert(textOf(native.sends[0]).includes('Original draft original-file'))
    assert.equal(native.sends[0].prompt.content[0].type, 'image')
    assert.equal(native.sends[0].prompt.content[0].data, Buffer.from('synthetic image bytes').toString('base64'))
    native.admit()
    await tick()
    assert.equal(native.input.state.getSnapshot().draft, 'Next user draft')
    assert.equal(native.input.state.getSnapshot().occurrences.length, 0)
  } finally { connected?.dispose(); native.dispose(); publishWorkbenchComposerContext('session-A') }
})

test('CAT reference requires explicit attachment after clearing or manual removal', async () => {
  const native = nativeComposer()
  let connected
  try {
    publish()
    native.ctx.inputTriggers.registerSource(catReferenceSource)
    connected = connectCatReference(native.ctx, 'session-A', () => {})
    assert.equal(native.input.state.getSnapshot().draft, '', 'connecting leaves an empty native composer alone')
    assert(connected.attach({ start: 0, end: 0, draftRev: native.input.state.getSnapshot().draftRev }))
    assert.equal(native.input.state.getSnapshot().draft, '@CAT ')
    native.input.submit()
    assert.equal(native.input.state.getSnapshot().draft, '')
    await tick()
    assert.equal(native.input.state.getSnapshot().draft, '')
    native.admit()
    assert.equal(native.input.state.getSnapshot().draft, '', 'successful send does not insert another reference')
    assert(connected.attach({ start: 0, end: 0, draftRev: native.input.state.getSnapshot().draftRev }))
    assert.equal(native.input.state.getSnapshot().draft, '@CAT ')
    native.actx.bail('slash/input-consume-token', { guard: { kind: 'span', span: { start: 0, end: 1, draftRev: native.input.state.getSnapshot().draftRev } } })
    publish(['segment-B'])
    assert.equal(native.input.state.getSnapshot().occurrences.length, 0, 'manual removal is not immediately undone by selection changes')
  } finally { connected?.dispose(); native.dispose(); publishWorkbenchComposerContext('session-A') }
})

test('CAT reference freezes before asynchronous slash arbitration and preserves rejected drafts', async () => {
  const native = nativeComposer()
  let connected
  try {
    publish()
    native.ctx.inputTriggers.registerSource(catReferenceSource)
    native.input.setDraft('/unclaimed ')
    connected = connectCatReference(native.ctx, 'session-A', () => {})
    connected.attach({ start: 11, end: 11, draftRev: native.input.state.getSnapshot().draftRev })
    let settle
    native.ctx.arbitrate = () => new Promise(resolve => { settle = resolve })
    native.failPrompt()
    native.input.submit()
    assert.equal(native.input.state.getSnapshot().phase, 'adjudicating')
    publish(['segment-B'])
    settle(undefined)
    await tick()
    assert.equal(contextOf(textOf(native.sends[0])).context.selectedSegmentIds[0], 'segment-A')
    assert.equal(native.input.state.getSnapshot().draft, '/unclaimed @CAT ')
  } finally { connected?.dispose(); native.dispose(); publishWorkbenchComposerContext('session-A') }
})

test('closing a duplicate CAT dock preserves the surviving dock reader and slash snapshot', async () => {
  const native = nativeComposer()
  let first, second
  try {
    publish()
    native.ctx.inputTriggers.registerSource(catReferenceSource)
    first = connectCatReference(native.ctx, 'session-A', () => {})
    second = connectCatReference(native.ctx, 'session-A', () => {})
    second.dispose()
    second = undefined
    native.input.setDraft('First dock task ')
    assert(first.attach({ start: 16, end: 16, draftRev: native.input.state.getSnapshot().draftRev }))
    native.input.submit()
    await tick()
    assert.equal(native.sends.length, 1)
    assert.deepEqual(contextOf(textOf(native.sends[0])).context.selectedSegmentIds, ['segment-A'])
    native.admit()

    native.input.setDraft('/unclaimed ')
    assert(first.attach({ start: 11, end: 11, draftRev: native.input.state.getSnapshot().draftRev }))
    let settle
    native.ctx.arbitrate = () => new Promise(resolve => { settle = resolve })
    native.input.submit()
    assert.equal(native.input.state.getSnapshot().phase, 'adjudicating')
    publish(['segment-B'])
    settle(undefined)
    await tick()
    assert.deepEqual(contextOf(textOf(native.sends[1])).context.selectedSegmentIds, ['segment-A'])
    native.admit()

    native.input.setDraft('Keep this task ')
    assert(first.attach({ start: 15, end: 15, draftRev: native.input.state.getSnapshot().draftRev }))
    const draft = native.input.state.getSnapshot().draft
    first.dispose()
    first = undefined
    assert.throws(() => catReferenceSource.codec.serialize('session-A', new AbortController().signal), /CAT selection is unavailable/)
    native.input.submit()
    await tick()
    assert.equal(native.sends.length, 2, 'no dock remains to supply the reference')
    assert.equal(native.input.state.getSnapshot().draft, draft)
  } finally { second?.dispose(); first?.dispose(); native.dispose(); publishWorkbenchComposerContext('session-A') }
})

test('missing or oversized CAT context blocks the native send and retains the draft', async () => {
  for (const missing of [false, true]) {
    const native = nativeComposer()
    let connected
    try {
      publish()
      native.ctx.inputTriggers.registerSource(catReferenceSource)
      connected = connectCatReference(native.ctx, 'session-A', () => {})
      assert(connected.attach({ start: 0, end: 0, draftRev: native.input.state.getSnapshot().draftRev }))
      native.actx.bail('slash/input-insert-text', { text: 'Keep my task', span: { start: 2, end: 2, draftRev: native.input.state.getSnapshot().draftRev } })
      const draft = native.input.state.getSnapshot().draft
      if (missing) publishWorkbenchComposerContext('session-A')
      else publish(Array.from({ length: 101 }, (_, index) => `segment-${index}`))
      native.input.submit()
      await tick()
      assert.equal(native.sends.length, 0)
      assert.equal(native.input.state.getSnapshot().draft, draft)
      assert.equal(native.input.state.getSnapshot().occurrences.length, 1)
    } finally { connected?.dispose(); native.dispose(); publishWorkbenchComposerContext('session-A') }
  }
})
