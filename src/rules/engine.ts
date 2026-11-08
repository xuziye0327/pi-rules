import { homedir } from 'node:os'
import { relative, resolve } from 'node:path'

import { readConfiguration } from './config.ts'
import { uniqueDiagnostics, warning } from './diagnostics.ts'
import { compareCandidates, discoverRules } from './discovery.ts'
import { formatRules } from './formatter.ts'
import { RuleMatcher } from './matcher.ts'
import { isWithin, physicalPath, slash } from './paths.ts'
import type {
  BatchStats,
  Diagnostic,
  DiscoveryOptions,
  FormatResult,
  LoadedRule,
  RuleObservation,
  RulesConfig,
  RuleFileSystem,
  RulesFlags,
  RuleSource,
} from './types.ts'

export interface EngineOptions {
  homeDir?: string
  allowlist?: readonly RuleSource[]
  fs?: RuleFileSystem
  env?: Record<string, string | undefined>
}

export interface RulesSnapshot {
  sessionRoot: string
  config: RulesConfig
  known: readonly RuleObservation[]
  activated: readonly LoadedRule[]
  injected: ReadonlySet<string>
  diagnostics: Readonly<Record<string, readonly Diagnostic[]>>
  warnings: readonly Diagnostic[]
  stats?: BatchStats
}

export class RulesEngine {
  private readonly environment: Record<string, string | undefined>
  private readonly matcher = new RuleMatcher()
  private readonly active = new Map<string, LoadedRule>()
  private readonly native = new Set<string>()
  private general: LoadedRule[] = []
  private observations: RuleObservation[] = []
  private injected = new Set<string>()
  private domains: Record<string, Diagnostic[]> = {}
  private lastTargets: string[] = []
  private lastTargetCwd = ''
  private discoveryOptions?: DiscoveryOptions
  private lastStats?: BatchStats
  private config: RulesConfig
  private identity = 0
  private readonly options: EngineOptions

  constructor(options: EngineOptions = {}) {
    this.options = options
    this.environment = { ...(options.env ?? process.env) }
    const parsed = readConfiguration(this.environment, {})
    this.config = parsed.config
    this.domains.configuration = parsed.diagnostics
  }

  get sessionIdentity(): number {
    return this.identity
  }

  get snapshot(): RulesSnapshot {
    const diagnostics = Object.fromEntries(
      Object.entries(this.domains).map(([key, items]) => [key, [...items]]),
    )
    return {
      sessionRoot: this.discoveryOptions?.sessionRoot ?? '',
      config: { ...this.config },
      known: [...this.observations],
      activated: [...this.active.values()],
      injected: new Set(this.injected),
      diagnostics,
      warnings: uniqueDiagnostics(Object.values(diagnostics).flat()),
      stats: this.lastStats && { ...this.lastStats },
    }
  }

  syncFlags(flags: RulesFlags): void {
    const parsed = readConfiguration(this.environment, flags)
    this.config = parsed.config
    this.domains.configuration = parsed.diagnostics
  }

  startSession(cwd: string): void {
    this.identity++
    this.active.clear()
    this.general = []
    this.observations = []
    this.injected.clear()
    this.native.clear()
    this.lastTargets = []
    this.lastTargetCwd = ''
    this.lastStats = undefined
    this.domains = { configuration: this.domains.configuration ?? [] }
    this.discoveryOptions = undefined
    try {
      this.discoveryOptions = {
        sessionRoot: physicalPath(cwd, cwd, this.options.fs),
        homeDir: physicalPath(this.options.homeDir ?? homedir(), cwd, this.options.fs),
        allowlist: this.options.allowlist,
        fs: this.options.fs,
      }
    } catch (error) {
      this.domains.loading = [warning('read-failed', cwd, error)]
      return
    }
    this.refresh()
  }

  prepareAgent(nativePaths: readonly string[]): void {
    if (!this.discoveryOptions) return
    this.refresh()
    this.native.clear()
    const errors: Diagnostic[] = []
    for (const path of nativePaths) {
      try {
        this.native.add(physicalPath(path, this.discoveryOptions.sessionRoot, this.options.fs))
      } catch (error) {
        errors.push(warning('read-failed', path, error))
      }
    }
    this.domains.loading = uniqueDiagnostics([...(this.domains.loading ?? []), ...errors])
  }

  activateTargets(paths: readonly string[], cwd: string): void {
    if (!this.discoveryOptions || this.config.disabled || this.config.mode === 'off') return
    const diagnostics: Diagnostic[] = []
    let targetCwd: string
    try {
      targetCwd = physicalPath(cwd, cwd, this.options.fs)
    } catch (error) {
      this.domains.loading = [warning('read-failed', cwd, error)]
      return
    }
    const targets = new Set<string>()
    for (const path of new Set(paths.map((input) => resolve(targetCwd, input)))) {
      try {
        targets.add(physicalPath(path, cwd, this.options.fs))
      } catch (error) {
        diagnostics.push(warning('read-failed', path, error))
      }
    }
    if (targets.size === 0) {
      this.domains.loading = diagnostics
      return
    }
    const batch = discoverRules(this.discoveryOptions, this.knownCandidates())
    this.lastStats = batch.stats
    diagnostics.push(...this.refreshActive(batch.observations))
    this.general = this.generalRules(batch.observations)
    this.lastTargets = [...targets]
    this.lastTargetCwd = targetCwd
    this.observations = this.matchObservations(batch.observations, diagnostics)
    const selected = new Map<string, LoadedRule>()
    for (const observation of this.observations) {
      if (observation.rule && observation.matchReason && !selected.has(observation.realPath)) {
        selected.set(observation.realPath, observation.rule)
      }
    }
    for (const [path, rule] of selected) {
      const previous = this.active.get(path)
      this.active.set(path, previous?.contentHash === rule.contentHash ? previous : rule)
    }
    this.domains.loading = uniqueDiagnostics([...batch.diagnostics, ...diagnostics])
  }

  formatRequest(): FormatResult {
    if (this.config.disabled || this.config.mode === 'off') {
      return { text: '', included: [], omitted: [], diagnostics: [] }
    }
    const groups: LoadedRule[] = []
    if (this.config.mode !== 'dynamic') groups.push(...this.general)
    if (this.config.mode !== 'static') groups.push(...this.active.values())
    const seen = new Set<string>(this.native)
    const selected = groups.filter((rule) => {
      if (seen.has(rule.realPath)) return false
      seen.add(rule.realPath)
      return true
    })
    return formatRules(selected, this.config)
  }

  commitInjection(result: FormatResult): void {
    this.injected = new Set(result.included.map(({ rule }) => rule.ruleKey))
    this.domains.formatting = uniqueDiagnostics(result.diagnostics)
  }

  inspect(): RulesSnapshot {
    if (!this.discoveryOptions) return this.snapshot
    const batch = discoverRules(this.discoveryOptions, this.knownCandidates())
    const diagnostics: Diagnostic[] = [...batch.diagnostics]
    this.observations = this.matchObservations(batch.observations, diagnostics)
    this.lastStats = batch.stats
    this.domains.inspection = uniqueDiagnostics(diagnostics)
    return this.snapshot
  }

  reload(): { updated: number; removed: number } {
    const previous = new Map([...this.active].map(([path, rule]) => [path, rule.ruleKey]))
    this.refresh()
    this.injected.clear()
    this.domains.formatting = []
    this.domains.inspection = []
    let updated = 0
    let removed = 0
    for (const [path, key] of previous) {
      const next = this.active.get(path)
      if (!next) removed++
      else if (next.ruleKey !== key) updated++
    }
    return { updated, removed }
  }

  setUIDiagnostic(error?: unknown): void {
    this.domains.ui = error === undefined ? [] : [warning('ui-failed', 'pi-rules', error)]
  }

  private knownCandidates(): RuleObservation[] {
    const candidates = new Map<string, RuleObservation>()
    for (const item of [...this.observations, ...this.active.values()]) {
      const key = JSON.stringify([item.source, item.discoveredPath])
      candidates.set(key, item)
    }
    return [...candidates.values()]
  }

  private generalRules(observations: readonly RuleObservation[]): LoadedRule[] {
    const selected = new Map<string, LoadedRule>()
    for (const item of [...observations].sort(compareCandidates)) {
      if (item.rule?.metadata.alwaysApply && !selected.has(item.realPath)) {
        const previous = this.general.find(
          (rule) =>
            rule.realPath === item.realPath &&
            rule.discoveredPath === item.discoveredPath &&
            rule.source === item.source,
        )
        selected.set(
          item.realPath,
          previous?.contentHash === item.rule.contentHash ? previous : item.rule,
        )
      }
    }
    return [...selected.values()]
  }

  private refreshActive(observations: readonly RuleObservation[]): Diagnostic[] {
    const diagnostics: Diagnostic[] = []
    for (const [path, previous] of this.active) {
      const found = observations.find(
        (item) =>
          item.discoveredPath === previous.discoveredPath &&
          item.source === previous.source &&
          item.realPath === path,
      )
      if (!found?.rule) {
        this.active.delete(path)
        if (!found)
          diagnostics.push(
            warning(
              'read-failed',
              previous.discoveredPath,
              'Activated rule is no longer available at its discovered path.',
            ),
          )
      } else if (found.rule.contentHash !== previous.contentHash) {
        this.active.set(path, found.rule)
      }
    }
    return diagnostics
  }

  private refresh(): void {
    if (!this.discoveryOptions) return
    const batch = discoverRules(this.discoveryOptions, this.knownCandidates())
    this.lastStats = batch.stats
    const diagnostics = [...batch.diagnostics, ...this.refreshActive(batch.observations)]
    this.general = this.generalRules(batch.observations)
    this.observations = this.matchObservations(batch.observations, diagnostics)
    this.domains.loading = uniqueDiagnostics(diagnostics)
  }

  private matchObservations(
    observations: readonly RuleObservation[],
    diagnostics: Diagnostic[],
  ): RuleObservation[] {
    const insideTargets = new Map(
      this.lastTargets.map((target) => [
        target,
        this.discoveryOptions ? isWithin(this.discoveryOptions.sessionRoot, target) : false,
      ]),
    )
    return [...observations].sort(compareCandidates).map((item) => {
      const observation: RuleObservation = { ...item, matchReason: undefined, targets: [] }
      if (!item.rule || !this.discoveryOptions) return observation
      for (const target of this.lastTargets) {
        const inside = insideTargets.get(target) ?? false
        if (!inside && !item.isGlobal) continue
        const result = this.matcher.match(
          item.rule,
          slash(target),
          this.discoveryOptions.sessionRoot,
          inside,
        )
        diagnostics.push(...result.diagnostics)
        if (result.reason) {
          observation.matchReason ??= result.reason
          observation.targets?.push(slash(relative(this.lastTargetCwd, target)))
        }
      }
      return observation
    })
  }
}
