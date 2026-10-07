export type Role = 'employee' | 'manager' | 'hr_admin'

/** Message content blocks, in the same shape the Anthropic Messages API uses. */
export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

export interface Message {
  role: 'user' | 'assistant'
  content: string | Block[]
}

export interface ToolSpec {
  name: string
  description: string
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

export interface PlanRequest {
  system: string
  tools: ToolSpec[]
  messages: Message[]
  signal?: AbortSignal
}

/** Something that reads the conversation so far and decides what to do next: a language model, or rules. */
export interface Planner {
  readonly name: 'claude' | 'rules'
  plan(req: PlanRequest): Promise<Block[]>
}

/** What the UI watches while the agent works. */
export type AgentEvent =
  | { type: 'step'; callId: string; tool: string; input: Record<string, unknown>; write: boolean }
  | { type: 'result'; callId: string; tool: string; ok: boolean; output: unknown; ms: number; declined?: boolean }
  | { type: 'approval'; callId: string; tool: string; input: Record<string, unknown>; summary: string }
  | { type: 'text'; text: string }
  | { type: 'done'; steps: number }
  | { type: 'error'; message: string }

export interface AuditEntry {
  at: string
  actor: string
  tool: string
  input: Record<string, unknown>
  write: boolean
  outcome: 'ok' | 'error' | 'denied' | 'declined' | 'approved'
  detail: string
}
