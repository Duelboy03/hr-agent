import type { Block, PlanRequest, Planner } from '../types'

export interface ClaudePlannerOptions {
  apiKey: string
  model?: string
  baseUrl?: string
  maxTokens?: number
  /** true when called from a browser, where Anthropic requires an explicit opt-in header */
  browser?: boolean
  fetch?: typeof fetch
}

/** Lets Claude decide which tools to call, using the Messages API tool-use protocol. */
export class ClaudePlanner implements Planner {
  readonly name = 'claude' as const
  constructor(private o: ClaudePlannerOptions) {}

  async plan(req: PlanRequest): Promise<Block[]> {
    const f = this.o.fetch ?? fetch
    const res = await f(`${this.o.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      signal: req.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.o.apiKey,
        'anthropic-version': '2023-06-01',
        ...(this.o.browser ? { 'anthropic-dangerous-direct-browser-access': 'true' } : {}),
      },
      body: JSON.stringify({
        model: this.o.model ?? 'claude-sonnet-5-5',
        max_tokens: this.o.maxTokens ?? 1024,
        system: req.system,
        tools: req.tools,
        messages: req.messages,
      }),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new Error(`Claude request failed: ${body?.error?.message ?? `${res.status} ${res.statusText}`}`)
    if (!body || !Array.isArray(body.content)) throw new Error('Claude returned an unexpected response.')
    const out: Block[] = []
    for (const b of body.content as Record<string, unknown>[]) {
      if (b.type === 'text' && typeof b.text === 'string') out.push({ type: 'text', text: b.text })
      else if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') out.push({ type: 'tool_use', id: b.id, name: b.name, input: (b.input as Record<string, unknown>) ?? {} })
    }
    return out
  }
}
