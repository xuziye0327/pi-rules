import type { RulesSnapshot } from './rules/engine.ts'
import { slash } from './rules/paths.ts'
import type { RuleObservation } from './rules/types.ts'

const subcommands = ['list', 'show', 'paths', 'status']

export function ruleCompletions(prefix: string): { value: string; label: string }[] | null {
  const items = subcommands.filter((command) => command.startsWith(prefix))
  return items.length ? items.map((value) => ({ value, label: value })) : null
}

function uniqueRules(snapshot: RulesSnapshot): RuleObservation[] {
  const seen = new Set<string>()
  return snapshot.known.filter((rule) => {
    if (seen.has(rule.realPath)) return false
    seen.add(rule.realPath)
    return true
  })
}

export function rulesSummary(snapshot: RulesSnapshot): string {
  return `[pi-rules] known=${uniqueRules(snapshot).length} activated=${snapshot.activated.length} injected=${snapshot.injected.size} warnings=${snapshot.warnings.length}`
}

export function rulesCommand(args: string, snapshot: RulesSnapshot): string {
  const parsed = /^(\S+)(?:\s+([\s\S]*))?$/.exec(args.trim())
  if (!parsed) return rulesSummary(snapshot)
  const [, command, rest = ''] = parsed
  const known = uniqueRules(snapshot)
  if (command === 'paths')
    return known.map((rule) => rule.realPath).join('\n') || '[pi-rules] No known rules.'
  if (command === 'list') {
    const active = new Set(snapshot.activated.map((rule) => rule.realPath))
    return (
      snapshot.known
        .map((item) => {
          const injected = item.rule ? snapshot.injected.has(item.rule.ruleKey) : false
          const match = item.matchReason
            ? `${item.matchReason} for ${item.targets?.join(', ')}`
            : 'none (last edit/write targets)'
          return `${item.realPath}\n  source=${item.source} active=${active.has(item.realPath)} injected=${injected} match=${match}${item.error ? ` unreadable=${item.error}` : ''}`
        })
        .join('\n') || '[pi-rules] No known rules.'
    )
  }
  if (command === 'show') {
    let id = rest.trim()
    if (
      id.length >= 2 &&
      ((id.startsWith('"') && id.endsWith('"')) || (id.startsWith("'") && id.endsWith("'")))
    )
      id = id.slice(1, -1)
    if (!id) return 'Usage: /rules show <absolute real path, relative path or unique suffix>'
    const key = slash(id)
    const exact = known.filter((item) => slash(item.realPath) === key)
    const found = exact.length
      ? exact
      : known.filter(
          (item) =>
            slash(item.relativePath) === key ||
            slash(item.realPath).endsWith(`/${key}`) ||
            slash(item.discoveredPath).endsWith(`/${key}`),
        )
    if (found.length > 1)
      return `Ambiguous rule ID:\n${found.map((item) => item.realPath).join('\n')}`
    if (!found.length) return `Unknown rule: ${id}`
    const item = found[0]
    return item.error
      ? `Cannot read ${item.realPath}: ${item.error}`
      : `${item.realPath}\n${item.rule?.body ?? ''}`
  }
  if (command === 'status') {
    const { config } = snapshot
    const details = Object.entries(snapshot.diagnostics).flatMap(([domain, items]) =>
      items.map(
        (item) => `[${domain}] ${item.severity} ${item.code} ${item.source}: ${item.message}`,
      ),
    )
    return [
      rulesSummary(snapshot),
      `mode=${config.mode} disabled=${config.disabled} widget=${config.widget}`,
      `maxRuleChars=${config.maxRuleChars} maxResultChars=${config.maxResultChars}`,
      `sessionRoot=${snapshot.sessionRoot}`,
      ...details,
    ].join('\n')
  }
  return 'Usage: /rules [list|show <id>|paths|status]'
}
