import type { Diagnostic, RulesConfig, RulesFlags, RulesMode } from './types.ts'

/** Resolve an environment snapshot and the current flags without accessing globals. */
export function readConfiguration(
  env: Record<string, string | undefined>,
  flags: RulesFlags,
): { config: RulesConfig; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const warn = (source: string, message: string): void => {
    diagnostics.push({ severity: 'warning', code: 'invalid-config', source, message })
  }

  const budget = (source: string, fallback: number): number => {
    const raw = env[source]
    if (raw === undefined) return fallback
    const value = raw.trim()
    const parsed = Number(value)
    if (/^[0-9]+$/.test(value) && Number.isSafeInteger(parsed) && parsed > 0) return parsed
    warn(source, `Expected a positive decimal safe integer; using ${fallback}.`)
    return fallback
  }

  const maxRuleChars = budget('PI_RULES_MAX_RULE_CHARS', 12000)
  const maxResultChars = budget('PI_RULES_MAX_RESULT_CHARS', 40000)
  let mode: RulesMode = 'both'
  if (flags.mode !== undefined) {
    if (
      flags.mode === 'static' ||
      flags.mode === 'dynamic' ||
      flags.mode === 'both' ||
      flags.mode === 'off'
    ) {
      mode = flags.mode
    } else {
      warn('--pi-rules-mode', 'Expected static, dynamic, both, or off; using both.')
    }
  }

  let widget = true
  if (flags.widget !== undefined) {
    if (flags.widget === 'true' || flags.widget === 'false') {
      widget = flags.widget === 'true'
    } else {
      warn('--pi-rules-widget', 'Expected the string true or false; using true.')
    }
  }

  if (flags.disabled !== undefined && typeof flags.disabled !== 'boolean') {
    warn('--pi-rules-disabled', 'Expected a boolean presence flag; using false for the flag.')
  }
  const environmentDisabled = ['1', 'true', 'yes', 'on'].includes(
    (env.PI_RULES_DISABLED ?? '').trim().toLowerCase(),
  )

  return {
    config: {
      mode,
      widget,
      disabled: environmentDisabled || flags.disabled === true,
      maxRuleChars,
      maxResultChars,
    },
    diagnostics,
  }
}
