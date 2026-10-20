import type { Diagnostic } from './types.ts'

export function uniqueDiagnostics(items: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = JSON.stringify([item.code, item.source, item.message])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function warning(code: string, source: string, error: unknown): Diagnostic {
  return {
    severity: 'warning',
    code,
    source,
    message: error instanceof Error ? error.message : String(error),
  }
}
