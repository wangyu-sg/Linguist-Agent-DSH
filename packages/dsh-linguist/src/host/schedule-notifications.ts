import { createHash } from 'node:crypto'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { LinguistScheduleNotificationTarget, LinguistScheduleNotificationReceipt } from '@linguist/domain-service/contracts'

export interface FeishuDestination {
  id: string
  label: string
  appId: string
  appSecret: string
  chatId: string
  domain: 'feishu' | 'lark'
}
export interface FrozenNotificationTarget extends LinguistScheduleNotificationTarget { recipientHash: string }

const recipientHash = (target: FeishuDestination) => createHash('sha256').update(JSON.stringify([target.domain, target.appId, target.chatId])).digest('hex')

/** Outbound-only adapter; native DSH settings own secrets, tasks explicitly select recipients. */
export class ScheduleNotifications {
  constructor(private readonly getDestinations: () => readonly FeishuDestination[], private readonly request: typeof fetch = fetch) {}

  private get destinations(): readonly FeishuDestination[] {
    const destinations = this.getDestinations()
    if (new Set(destinations.map(item => item.id)).size !== destinations.length) throw new Error('Duplicate schedule notification destination id')
    return destinations
  }

  list(): Array<{ id: string; label: string }> { return this.destinations.map(({ id, label }) => ({ id, label })) }

  freeze(targets: readonly LinguistScheduleNotificationTarget[]): FrozenNotificationTarget[] {
    if (new Set(targets.map(item => item.destinationId)).size !== targets.length) throw new Error('Duplicate schedule notification target')
    return targets.map(target => {
      const destination = this.destinations.find(item => item.id === target.destinationId)
      if (!destination) throw new Error(`Unknown schedule notification destination: ${target.destinationId}`)
      return { ...target, recipientHash: recipientHash(destination) }
    })
  }

  async send(target: FrozenNotificationTarget, run: { scheduleId: string; messageId: string; sessionId: string; title: string; turn: number; outcome: string; failure?: { code: string; status?: number } }, events: readonly SessionEvent[]): Promise<LinguistScheduleNotificationReceipt> {
    const receipt = { destinationId: target.destinationId }
    const configured = this.destinations.find(item => item.id === target.destinationId)
    const destination = configured && { ...configured }
    if (!destination || recipientHash(destination) !== target.recipientHash) return { ...receipt, status: 'failed', code: 'DESTINATION_CHANGED' }
    const summary = run.outcome === 'completed'
      ? events.flatMap(event => event.type === 'assistant/message' && event.data.turn === run.turn ? event.data.message.content.filter(block => block.type === 'text').map(block => block.text) : []).join('\n\n')
      : [run.outcome, run.failure?.code, run.failure?.status].filter(value => value !== undefined).join(' · ')
    const card = { config: { wide_screen_mode: true }, header: { template: run.outcome === 'completed' ? 'blue' : 'red',
      title: { tag: 'plain_text', content: run.outcome === 'completed' ? '定时任务执行结束' : '定时任务执行未成功' } },
    elements: [{ tag: 'markdown', content: [`**任务**: ${run.title}`, `**会话 ID**: ${run.sessionId}`,
      '执行结束不等于专业审校、交付或外部平台确认。', '', summary.length > 12000 ? `${summary.slice(0, 12000)}\n…请在 DSH 查看完整会话。` : summary || '本轮无文本输出。'].join('\n') }] }
    const base = destination.domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn'
    let posting = false
    try {
      const auth = await this.request(`${base}/open-apis/auth/v3/tenant_access_token/internal`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ app_id: destination.appId, app_secret: destination.appSecret }),
      })
      if (!auth.ok) return { ...receipt, status: 'failed', code: `AUTH_HTTP_${auth.status}` }
      const token = await auth.json() as { code?: number; tenant_access_token?: string }
      if (token?.code !== 0 || typeof token.tenant_access_token !== 'string' || !token.tenant_access_token) return { ...receipt, status: 'failed', code: 'AUTH_REJECTED' }
      posting = true
      const result = await this.request(`${base}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.tenant_access_token}` }, redirect: 'error', signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ receive_id: destination.chatId, msg_type: 'interactive', content: JSON.stringify(card),
          uuid: createHash('sha256').update(JSON.stringify([run.scheduleId, run.messageId, target.recipientHash])).digest('hex').slice(0, 40) }),
      })
      if (!result.ok) return { ...receipt, status: 'unknown', code: `SEND_HTTP_${result.status}` }
      const sent = await result.json() as { code?: number; data?: { message_id?: string } }
      if (typeof sent?.code === 'number' && sent.code !== 0) return { ...receipt, status: 'failed', code: `SEND_CODE_${sent.code}` }
      if (sent?.code !== 0 || typeof sent.data?.message_id !== 'string' || !sent.data.message_id) return { ...receipt, status: 'unknown', code: 'SEND_RECEIPT_MISSING' }
      return { ...receipt, status: 'sent', messageId: sent.data.message_id }
    } catch {
      // A send transport failure cannot prove the remote did not accept the message.
      return { ...receipt, status: posting ? 'unknown' : 'failed', code: posting ? 'SEND_TRANSPORT' : 'AUTH_TRANSPORT' }
    }
  }
}
