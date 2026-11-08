import { posix } from 'node:path'

import picomatch from 'picomatch'

import type { Diagnostic, LoadedRule } from './types.ts'

interface MatchResult {
  reason?: string
  diagnostics: Diagnostic[]
}

export class RuleMatcher {
  match(rule: LoadedRule, targetKey: string, sessionRoot: string, isInside: boolean): MatchResult {
    // Keep the source boundary even if the caller did not filter project candidates.
    if (!isInside && !rule.isGlobal) return { diagnostics: [] }
    if (rule.metadata.alwaysApply) return { reason: 'alwaysApply', diagnostics: [] }

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
      try {
        const test = picomatch(negative ? pattern.slice(1) : pattern, {
          bash: false,
          dot: true,
          nonegate: true,
          nocase: false,
          strictBrackets: true,
          // Picomatch otherwise replaces invalid regular expressions with /$^/.
          debug: true,
          windows: false,
        })
        if (negative) negatives.push(test)
        else positives.push({ pattern, test })
      } catch (error) {
        diagnostics.push({
          severity: 'warning',
          code: 'invalid-glob',
          source: rule.discoveredPath,
          message: `Invalid glob ${JSON.stringify(pattern)}: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    }

    let result: MatchResult = { diagnostics }
    if (diagnostics.length === 0) {
      const positive = positives.find(({ test }) => bases.some((basis) => test(basis)))
      if (positive && !negatives.some((test) => bases.some((basis) => test(basis)))) {
        result = { reason: positive.pattern, diagnostics }
      }
    }
    return result
  }
}
