import type * as fs from 'node:fs'

export type RuleSource = '.pi/rules' | '~/.pi/rules'
export type RulesMode = 'static' | 'dynamic' | 'both' | 'off'

export interface Diagnostic {
  severity: 'warning'
  code: string
  source: string
  message: string
}

export interface RuleCandidate {
  discoveredPath: string
  realPath: string
  source: RuleSource
  relativePath: string
  isGlobal: boolean
}

export interface RuleMetadata {
  alwaysApply: boolean
  description?: string
  globs: readonly string[]
}

export interface LoadedRule extends RuleCandidate {
  metadata: RuleMetadata
  body: string
  contentHash: string
  ruleKey: string
}

export interface RuleObservation extends RuleCandidate {
  rule?: LoadedRule
  error?: string
  matchReason?: string
  targets?: string[]
}

export interface RulesConfig {
  mode: RulesMode
  disabled: boolean
  widget: boolean
  maxRuleChars: number
  maxResultChars: number
}

export interface RulesFlags {
  disabled?: unknown
  mode?: unknown
  widget?: unknown
}

export interface FormatResult {
  text: string
  included: { rule: LoadedRule; truncated: boolean }[]
  omitted: LoadedRule[]
  diagnostics: Diagnostic[]
}

export interface BatchStats {
  scans: number
  reads: number
  parses: number
  hashes: number
  durationMs: number
}

export interface DiscoveryResult {
  observations: RuleObservation[]
  diagnostics: Diagnostic[]
  stats: BatchStats
}

export interface RuleFileSystem {
  globSync: typeof fs.globSync
  realpathSync: typeof fs.realpathSync
  lstatSync: typeof fs.lstatSync
  statSync: typeof fs.statSync
  readFileSync: typeof fs.readFileSync
}

export interface DiscoveryOptions {
  sessionRoot: string
  homeDir: string
  allowlist?: readonly RuleSource[]
  fs?: RuleFileSystem
}
