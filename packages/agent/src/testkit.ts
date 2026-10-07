import { AuditLog } from './audit'
import { Hris } from './hris'
import { AgentSession } from './session'
import { RulesPlanner } from './planners/rules'
import type { AgentEvent, Block, Message, PlanRequest, Planner } from './types'

export const TODAY = '2026-10-07' // a Wednesday

export function world(actorId: 'meera' | 'arjun' | 'priya' | 'liam' = 'meera', planner?: Planner) {
  const hris = new Hris(TODAY)
  const audit = new AuditLog(() => new Date('2026-10-07T09:00:00Z'))
  const actor = hris.get(actorId)!
  const session = new AgentSession({ hris, actor, audit, planner: planner ?? new RulesPlanner(() => TODAY), now: () => 0 })
  return { hris, audit, actor, session }
}

export async function collect(g: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = []
  for await (const e of g) out.push(e)
  return out
}

/** A planner that replays a script: each entry is the blocks returned for one planning call. */
export class ScriptedPlanner implements Planner {
  readonly name = 'rules' as const
  seen: PlanRequest[] = []
  private i = 0
  constructor(private script: (Block[] | ((req: PlanRequest) => Block[]))[]) {}
  async plan(req: PlanRequest): Promise<Block[]> {
    this.seen.push({ ...req, messages: structuredClone(req.messages) as Message[] })
    const next = this.script[Math.min(this.i++, this.script.length - 1)]
    return typeof next === 'function' ? next(req) : next
  }
}

export const use = (id: string, name: string, input: Record<string, unknown> = {}): Block => ({ type: 'tool_use', id, name, input })
export const say = (text: string): Block[] => [{ type: 'text', text }]

export const types = (events: AgentEvent[]) => events.map((e) => e.type)
export const finalText = (events: AgentEvent[]) => events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('\n')
