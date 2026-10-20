import type { Diagnostic, FormatResult, LoadedRule, RulesConfig } from './types.ts'

const OPEN = '<pi_rules>\n\n## Project Instructions\n'
const CLOSE = '\n</pi_rules>'

/** Format in caller-supplied priority order; only included entries spend budget. */
export function formatRules(
  rules: readonly LoadedRule[],
  config: Pick<RulesConfig, 'maxRuleChars' | 'maxResultChars'>,
): FormatResult {
  const included: FormatResult['included'] = []
  const omitted: LoadedRule[] = []
  const diagnostics: Diagnostic[] = []
  const entries: string[] = []
  let remaining = config.maxResultChars - OPEN.length - CLOSE.length

  for (const rule of rules) {
    const header = `Instructions from: ${rule.discoveredPath}\n`
    const separatorLength = included.length === 0 ? 0 : 2
    const capacity = Math.min(config.maxRuleChars, remaining - header.length - separatorLength)
    let body = rule.body
    let truncated = false

    if (capacity >= 0 && body.length > capacity) {
      const notice = `\n\n[Rule truncated. Read full rule: ${rule.discoveredPath}]`
      let end = Math.max(0, capacity - notice.length)
      // A boundary between a high and low surrogate would bisect a codepoint.
      if (
        end > 0 &&
        isHighSurrogate(body.charCodeAt(end - 1)) &&
        isLowSurrogate(body.charCodeAt(end))
      ) {
        end -= 1
      }
      if (end > 0) {
        body = body.slice(0, end) + notice
        truncated = true
      }
    }

    if (capacity < 0 || body.length > capacity) {
      omitted.push(rule)
      diagnostics.push({
        severity: 'warning',
        code: 'rule-omitted',
        source: rule.discoveredPath,
        message:
          'Rule omitted because its source header or minimum body does not fit the character budgets.',
      })
      continue
    }

    entries.push(header + body)
    remaining -= separatorLength + header.length + body.length
    included.push({ rule, truncated })
    if (truncated) {
      diagnostics.push({
        severity: 'warning',
        code: 'rule-truncated',
        source: rule.discoveredPath,
        message: 'Rule truncated to fit the character budgets; the full-rule notice is included.',
      })
    }
  }

  return {
    text: entries.length === 0 ? '' : OPEN + entries.join('\n\n') + CLOSE,
    included,
    omitted,
    diagnostics,
  }
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}
