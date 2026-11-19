import type { SessionEventLike } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConversationNodeDefinition, TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { LibraryPreparationOffer } from '@linguist/domain-service/contracts'

const key = 'linguist-library-preparation'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    [key]: LibraryPreparationOffer[]
  }
}

// This list slot is owned by the supported DSH Chat renderer. LA uses it without importing Chat at runtime.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'conversation.chat.turnTail': {
      kind: 'list'
      scope: 'session'
      owner: { turn: TurnLocation; seq: number; openFile: (path: string) => void }
    }
  }
}

function preparationOffer(event: SessionEventLike): LibraryPreparationOffer | undefined {
  if (event.type !== 'tool/result' || event.data.message.isError) return
  const meta = event.data.meta
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return
  const offer = meta.linguistLibraryPreparation
  if (!offer || typeof offer !== 'object' || Array.isArray(offer) || typeof offer.projectId !== 'string' || !Array.isArray(offer.groups)) return
  const groups = offer.groups.flatMap(group =>
    group && typeof group === 'object' && !Array.isArray(group) && typeof group.id === 'string' && typeof group.name === 'string' && typeof group.offeredAt === 'number'
      ? [{ id: group.id, name: group.name, offeredAt: group.offeredAt }] : [])
  const registrations: NonNullable<LibraryPreparationOffer['registrations']> = Array.isArray(offer.registrations)
    ? offer.registrations.flatMap(item => item && typeof item === 'object' && !Array.isArray(item)
      && typeof item.path === 'string' && typeof item.filename === 'string' && typeof item.taskGroupId === 'string'
      && (item.status === 'ready' || item.status === 'manual' || item.status === 'error')
      ? [{ path: item.path, filename: item.filename, taskGroupId: item.taskGroupId, status: item.status }] : [])
    : []
  if (groups.length || registrations.length) return { projectId: offer.projectId, groups, registrations }
}

export const libraryPreparationTurn: ConversationNodeDefinition<LibraryPreparationOffer[]> = {
  kind: key,
  match: event => event.type === 'tool/result' && preparationOffer(event) ? { id: String(event.data.turn), role: 'start' } : null,
  start: (_context, match) => [preparationOffer(match.event)!],
  update: ({ state }, match) => {
    const offer = preparationOffer(match.event)!
    const prior = state.find(value => value.projectId === offer.projectId)
    const groups = new Map([...(prior?.groups ?? []), ...offer.groups].map(group => [group.id, group]))
    const registrations = new Map([...(prior?.registrations ?? []), ...(offer.registrations ?? [])]
      .map(item => [JSON.stringify([item.path, item.taskGroupId]), item]))
    return [...state.filter(value => value.projectId !== offer.projectId), { projectId: offer.projectId, groups: [...groups.values()], registrations: [...registrations.values()] }]
  },
  buildLocationData: ({ id, state }, scope, previous) => {
    if (scope === 'turn' && state) return previous?.value === state ? previous : { kind: 'turn', turn: Number(id), key, value: state }
    return null
  },
}
