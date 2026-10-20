import { createHash } from 'node:crypto'
import * as nodeFs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

import { parseFrontmatter } from './frontmatter.ts'
import { isWithin, physicalPath, slash } from './paths.ts'
import type {
  Diagnostic,
  DiscoveryOptions,
  DiscoveryResult,
  LoadedRule,
  RuleCandidate,
  RuleObservation,
  RuleSource,
} from './types.ts'

const excludedDirectories = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.turbo',
  '.next',
  'coverage',
])
const sources: readonly RuleSource[] = ['.pi/rules', '~/.pi/rules']

type Scan = { entries: nodeFs.Dirent[]; pruned: string[]; error?: unknown }
type Content = Pick<LoadedRule, 'metadata' | 'body' | 'contentHash' | 'ruleKey'>
type ReadResult = { content: Content } | { error: unknown }

function missing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function compareCandidates(a: RuleCandidate, b: RuleCandidate): number {
  return (
    Number(a.isGlobal) - Number(b.isGlobal) ||
    compareString(a.relativePath, b.relativePath) ||
    compareString(a.realPath, b.realPath)
  )
}

export function discoverRules(
  options: DiscoveryOptions,
  knownCandidates: readonly RuleCandidate[] = [],
): DiscoveryResult {
  const started = performance.now()
  const fs = options.fs ?? nodeFs
  const stats = { scans: 0, reads: 0, parses: 0, hashes: 0, durationMs: 0 }
  const diagnostics: Diagnostic[] = []
  const diagnosticKeys = new Set<string>()
  const observations: RuleObservation[] = []
  const scans = new Map<string, Scan>()
  const realpaths = new Map<string, { value: string } | { error: unknown }>()
  const reads = new Map<string, ReadResult>()
  const projectContainment = new Map<string, boolean>()
  const candidates = new Map<string, RuleCandidate>()
  const allowed = new Set(options.allowlist ?? sources)

  function addDiagnostic(diagnostic: Diagnostic) {
    const key = JSON.stringify([diagnostic.code, diagnostic.source, diagnostic.message])
    if (diagnosticKeys.has(key)) return
    diagnosticKeys.add(key)
    diagnostics.push(diagnostic)
  }

  function warn(code: string, source: string, text: string) {
    addDiagnostic({ severity: 'warning', code, source, message: text })
  }

  function realpath(input: string): string {
    let result = realpaths.get(input)
    if (!result) {
      try {
        result = { value: slash(fs.realpathSync(input)) }
      } catch (error) {
        result = { error }
      }
      realpaths.set(input, result)
    }
    if ('error' in result) throw result.error
    return result.value
  }

  function withinProject(root: string, target: string): boolean {
    const cached = projectContainment.get(target)
    if (cached !== undefined) return cached
    const result = isWithin(root, target)
    projectContainment.set(target, result)
    return result
  }

  function scan(realRoot: string): Scan {
    const cached = scans.get(realRoot)
    if (cached) return cached
    const result: Scan = { entries: [], pruned: [] }
    // Cache failures too: aliases must not rescan the same physical directory.
    scans.set(realRoot, result)
    stats.scans++
    try {
      result.entries = fs.globSync('**/*.mdc', {
        cwd: realRoot,
        withFileTypes: true,
        exclude: (entry) => {
          if (!entry.isDirectory()) return false
          if (excludedDirectories.has(entry.name)) return true
          const relative = slash(path.relative(realRoot, path.join(entry.parentPath, entry.name)))
          if (relative.split('/').length <= 10) return false
          result.pruned.push(relative)
          return true
        },
      })
    } catch (error) {
      result.error = error
    }
    return result
  }

  for (const source of sources) {
    if (!allowed.has(source)) continue
    const isGlobal = source === '~/.pi/rules'
    const base = path.resolve(isGlobal ? options.homeDir : options.sessionRoot)
    const sourceRoot = slash(path.join(base, '.pi', 'rules'))
    let boundary: string
    let realRoot: string
    try {
      boundary = physicalPath(base, process.cwd(), fs)
      realRoot = realpath(sourceRoot)
      if (!isGlobal && !withinProject(boundary, realRoot)) {
        warn('outside-project', sourceRoot, 'Project rule source resolves outside the session root.')
        continue
      }
      if (!fs.statSync(realRoot).isDirectory()) {
        warn('scan-failed', sourceRoot, 'Rule source is not a directory.')
        continue
      }
    } catch (error) {
      if (!missing(error)) warn('scan-failed', sourceRoot, message(error))
      continue
    }

    const scanned = scan(realRoot)
    if (scanned.error) warn('scan-failed', sourceRoot, message(scanned.error))
    for (const relative of scanned.pruned) {
      warn(
        'scan-depth-limit',
        slash(path.join(sourceRoot, relative)),
        'Rule directory exceeds depth 10.',
      )
    }

    const discoveredPaths = new Set<string>()
    for (const entry of scanned.entries) {
      if (!entry.isFile() && !entry.isSymbolicLink()) continue
      const relative = path.relative(realRoot, path.join(entry.parentPath, entry.name))
      discoveredPaths.add(slash(path.resolve(sourceRoot, relative)))
    }
    for (const known of knownCandidates) {
      if (known.source === source) discoveredPaths.add(slash(path.resolve(known.discoveredPath)))
    }

    for (const discoveredPath of discoveredPaths) {
      if (!isWithin(sourceRoot, discoveredPath)) continue
      const relative = slash(path.relative(sourceRoot, discoveredPath))
      const parts = relative.split('/')
      const directories = parts.slice(0, -1)
      if (!relative.endsWith('.mdc') || directories.some((part) => excludedDirectories.has(part)))
        continue
      if (directories.length > 10) {
        warn(
          'scan-depth-limit',
          slash(path.join(sourceRoot, ...directories.slice(0, 11))),
          'Rule directory exceeds depth 10.',
        )
        continue
      }
      const candidate: RuleCandidate = {
        discoveredPath,
        realPath: discoveredPath,
        source,
        relativePath: slash(path.relative(base, discoveredPath)),
        isGlobal,
      }
      try {
        const entry = fs.lstatSync(discoveredPath)
        if (!entry.isFile() && !entry.isSymbolicLink()) continue
        candidate.realPath = realpath(discoveredPath)
        if (!isGlobal && !withinProject(boundary, candidate.realPath)) {
          warn(
            'outside-project',
            discoveredPath,
            'Project rule file resolves outside the session root.',
          )
          continue
        }
        if (entry.isSymbolicLink() && !fs.statSync(candidate.realPath).isFile()) continue
      } catch (error) {
        if (!missing(error)) {
          warn('read-failed', discoveredPath, message(error))
          observations.push({ ...candidate, error: message(error) })
        }
        continue
      }
      candidates.set(`${source}\0${discoveredPath}`, candidate)
    }
  }

  function load(candidate: RuleCandidate): ReadResult {
    let raw: string
    stats.reads++
    try {
      raw = fs.readFileSync(candidate.realPath, 'utf8')
    } catch (error) {
      return { error }
    }
    stats.parses++
    const parsed = parseFrontmatter(raw, candidate.discoveredPath)
    for (const diagnostic of parsed.diagnostics) addDiagnostic(diagnostic)
    stats.hashes++
    const contentHash = createHash('sha256').update(raw).digest('hex')
    return {
      content: {
        metadata: parsed.metadata,
        body: parsed.body,
        contentHash,
        ruleKey: `${candidate.realPath}\0${contentHash}`,
      },
    }
  }

  for (const candidate of [...candidates.values()].sort(compareCandidates)) {
    let result = reads.get(candidate.realPath)
    if (!result) {
      result = load(candidate)
      reads.set(candidate.realPath, result)
    }
    if ('content' in result) {
      observations.push({ ...candidate, rule: { ...candidate, ...result.content } })
    } else {
      warn('read-failed', candidate.discoveredPath, message(result.error))
      if (!missing(result.error)) observations.push({ ...candidate, error: message(result.error) })
    }
  }

  observations.sort(compareCandidates)
  stats.durationMs = performance.now() - started
  return { observations, diagnostics, stats }
}
