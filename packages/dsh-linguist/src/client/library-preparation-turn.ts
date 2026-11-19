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
  if (groups.length) return { projectId: offer.projectId, groups }
}

export const libraryPreparationTurn: ConversationNodeDefinition<LibraryPreparationOffer[]> = {
  kind: key,
  match: event => event.type === 'tool/result' && preparationOffer(event) ? { id: String(event.data.turn), role: 'start' } : null,
  start: (_context, match) => [preparationOffer(match.event)!],
  update: ({ state }, match) => {
    const offer = preparationOffer(match.event)!
    const prior = state.find(value => value.projectId === offer.projectId)
    const groups = new Map([...(prior?.groups ?? []), ...offer.groups].map(group => [group.id, group]))
    return [...state.filter(value => value.projectId !== offer.projectId), { projectId: offer.projectId, groups: [...groups.values()] }]
  },
  buildLocationData: ({ id, state }, scope, previous) => {
    if (scope === 'turn' && state) return previous?.value === state ? previous : { kind: 'turn', turn: Number(id), key, value: state }
    return null
  },
}
