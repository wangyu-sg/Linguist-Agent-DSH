import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'
import type { LinguistProjectService } from '@linguist/domain-service'

const id = Type.String({ minLength: 1, maxLength: 100 })
const name = Type.String({ minLength: 1, maxLength: 180 })
export const GroupChange = Type.Union([
  Type.Object({ action: Type.Literal('create'), name }),
  Type.Object({ action: Type.Literal('rename'), id, name }),
  Type.Object({ action: Type.Union([Type.Literal('archive'), Type.Literal('restore'), Type.Literal('delete')]), id }),
  Type.Object({ action: Type.Literal('moveBatches'), id, batchIds: Type.Array(id, { minItems: 1 }) }),
])

export function changeTaskGroup(service: LinguistProjectService, projectId: string, change: unknown): string {
  if (!Value.Check(GroupChange, change)) throw new Error('任务组操作参数无效')
  service.assertProjectWritable(projectId)
  return service.openProject(projectId).taskGroups.change(change as Static<typeof GroupChange>)
}
