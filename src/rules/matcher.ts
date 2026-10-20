import { posix } from 'node:path'

import picomatch from 'picomatch'

import type { Diagnostic, LoadedRule } from './types.ts'

interface MatchResult {
  reason?: string
  diagnostics: Diagnostic[]
}

type CompiledPattern = { test: picomatch.Matcher; error?: never } | { test?: never; error: string }

class LruCache<T> {
  #entries = new Map<string, T>()
  #limit: number

  constructor(limit: number) {
    this.#limit = limit
  }

  get size(): number {
    return this.#entries.size
  }

  get(key: string): T | undefined {
    const value = this.#entries.get(key)
    if (value !== undefined) {
      this.#entries.delete(key)
      this.#entries.set(key, value)
    }
    return value
  }

  set(key: string, value: T): void {
    this.#entries.delete(key)
    this.#entries.set(key, value)
    if (this.#entries.size > this.#limit) {
      const oldest = this.#entries.keys().next().value
      if (oldest !== undefined) this.#entries.delete(oldest)
    }
  }

  clear(): void {
    this.#entries.clear()
  }
}

export class RuleMatcher {
  #compiled = new LruCache<CompiledPattern>(256)
  #matches = new LruCache<MatchResult>(4096)

  match(rule: LoadedRule, targetKey: string, sessionRoot: string, isInside: boolean): MatchResult {
    // Keep the source boundary even if the caller did not filter project candidates.
    if (!isInside && !rule.isGlobal) return { diagnostics: [] }
    if (rule.metadata.alwaysApply) return { reason: 'alwaysApply', diagnostics: [] }

    const key = JSON.stringify([targetKey, rule.ruleKey, sessionRoot, rule.isGlobal, isInside])
    const cached = this.#matches.get(key)
    if (cached !== undefined) return this.#resultForSource(cached, rule.discoveredPath)

    // Both inputs already use physical, absolute slash paths. POSIX operations keep
    // their code units intact, including on Windows drive and UNC paths.
    const basename = posix.basename(targetKey)
    const bases = isInside
      ? [...new Set([posix.relative(sessionRoot, targetKey), basename])]
      : [basename]
    const positives: { pattern: string; test: picomatch.Matcher }[] = []
    const negatives: picomatch.Matcher[] = []
    const diagnostics: Diagnostic[] = []

    // Compile every entry before evaluating: an invalid exclusion must never
    // accidentally broaden a rule whose positive pattern already matched.
    for (const pattern of rule.metadata.globs) {
      const negative = pattern.startsWith('!') && !pattern.startsWith('!(')
      const compiled = this.#compile(negative ? pattern.slice(1) : pattern)
      if (compiled.error !== undefined) {
        diagnostics.push({
          severity: 'warning',
          code: 'invalid-glob',
          source: rule.discoveredPath,
          message: `Invalid glob ${JSON.stringify(pattern)}: ${compiled.error}`,
        })
      } else if (negative) {
        negatives.push(compiled.test)
      } else {
        positives.push({ pattern, test: compiled.test })
      }
    }

    let result: MatchResult = { diagnostics }
    if (diagnostics.length === 0) {
      const positive = positives.find(({ test }) => bases.some((basis) => test(basis)))
      if (positive && !negatives.some((test) => bases.some((basis) => test(basis)))) {
        result = { reason: positive.pattern, diagnostics }
      }
    }
    this.#matches.set(key, result)
    return this.#resultForSource(result, rule.discoveredPath)
  }

  clear(): void {
    this.#compiled.clear()
    this.#matches.clear()
  }

  get cacheSizes(): { compiled: number; matches: number } {
    return { compiled: this.#compiled.size, matches: this.#matches.size }
  }

  #compile(pattern: string): CompiledPattern {
    const cached = this.#compiled.get(pattern)
    if (cached !== undefined) return cached

    let compiled: CompiledPattern
    try {
      compiled = {
        test: picomatch(pattern, {
          bash: false,
          dot: true,
          nonegate: true,
          nocase: false,
          strictBrackets: true,
          // Picomatch otherwise replaces invalid regular expressions with /$^/.
          debug: true,
          windows: false,
        }),
      }
    } catch (error) {
      compiled = { error: error instanceof Error ? error.message : String(error) }
    }
    this.#compiled.set(pattern, compiled)
    return compiled
  }

  #resultForSource(result: MatchResult, source: string): MatchResult {
    // Match keys identify content, not discovery aliases. Replay diagnostics for
    // this candidate and keep callers from mutating the cached diagnostic objects.
    return { ...result, diagnostics: result.diagnostics.map((item) => ({ ...item, source })) }
  }
}
