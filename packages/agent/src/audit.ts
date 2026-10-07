import type { AuditEntry } from './types'

/** Append-only record of everything the agent did, or was stopped from doing. */
export class AuditLog {
  private entries: AuditEntry[] = []
  private listeners = new Set<() => void>()
  constructor(private now: () => Date = () => new Date()) {}

  record(e: Omit<AuditEntry, 'at'>) {
    this.entries = [...this.entries, { at: this.now().toISOString(), ...e }]
    this.listeners.forEach((l) => l())
  }
  list = (): readonly AuditEntry[] => this.entries
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}
