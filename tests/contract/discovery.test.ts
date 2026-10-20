import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { discoverRules } from '../../src/rules/discovery.ts'
import { slash } from '../../src/rules/paths.ts'
import type { DiscoveryOptions, RuleCandidate, RuleFileSystem } from '../../src/rules/types.ts'
import {
  fileError,
  globalRule,
  homeDir,
  overlayFileSystem,
  projectRoot,
  projectRule,
} from '../helpers/fixtures.ts'

const options: DiscoveryOptions = { sessionRoot: projectRoot, homeDir }

function projectOnly(overrides: Partial<RuleFileSystem> = {}) {
  return discoverRules({ ...options, allowlist: ['.pi/rules'], fs: { ...fs, ...overrides } })
}

test('real filesystem discovery recursively loads only .mdc files in project-before-global order', () => {
  const result = discoverRules(options)
  assert.deepEqual(
    result.observations.map((item) => [item.source, item.relativePath]),
    [
      ['.pi/rules', '.pi/rules/10-general.mdc'],
      ['.pi/rules', '.pi/rules/20-typescript.mdc'],
      ['.pi/rules', '.pi/rules/nested/30-markdown.mdc'],
      ['~/.pi/rules', '.pi/rules/05-global.mdc'],
      ['~/.pi/rules', '.pi/rules/15-global-typescript.mdc'],
    ],
  )
  assert.deepEqual(result.observations[1].rule?.metadata, {
    alwaysApply: false,
    description: 'TypeScript sources',
    globs: ['src/**/*.ts', '!**/*.test.ts'],
  })
  assert.equal(result.observations[1].rule?.body, 'TypeScript instructions.\n')
  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.stats.scans, 2)
  assert.equal(result.stats.reads, 5)
  assert.equal(result.stats.parses, 5)
  assert.equal(result.stats.hashes, 5)
})

test('allowlists prevent unselected sources from contributing rules or filesystem work', () => {
  const empty = discoverRules({ ...options, allowlist: [] })
  assert.deepEqual(empty.observations, [])
  assert.equal(empty.stats.scans, 0)
  assert.equal(empty.stats.reads, 0)
  const global = discoverRules({ ...options, allowlist: ['~/.pi/rules'] })
  assert.deepEqual(
    global.observations.map((item) => item.realPath),
    [globalRule('05-global.mdc'), globalRule('15-global-typescript.mdc')],
  )
})

test('a missing rule directory is silent and does not stop another source loading', () => {
  const result = discoverRules({ ...options, homeDir: join(homeDir, '.pi') })
  assert.equal(result.observations.length, 3)
  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.stats.scans, 1)
})

test('physical source aliases are scanned and read once while retaining both source observations', () => {
  const result = discoverRules({ ...options, homeDir: projectRoot })
  assert.equal(result.observations.length, 6)
  assert.equal(result.stats.scans, 1)
  assert.equal(result.stats.reads, 3)
  assert.equal(result.stats.parses, 3)
  assert.equal(result.stats.hashes, 3)
  assert.deepEqual(
    result.observations.slice(0, 3).map((item) => item.source),
    Array(3).fill('.pi/rules'),
  )
  assert.deepEqual(
    result.observations.slice(3).map((item) => item.source),
    Array(3).fill('~/.pi/rules'),
  )
  assert.equal(result.observations[0].rule?.ruleKey, result.observations[3].rule?.ruleKey)
})

test('malformed frontmatter keeps the full text, disables partial metadata and reports its path', () => {
  const raw = '---\nalwaysApply: true\nglobs: [unterminated\n---\nRule body.'
  const result = projectOnly(overlayFileSystem(new Map([[projectRule('20-typescript.mdc'), raw]])))
  const rule = result.observations.find(
    (item) => item.realPath === projectRule('20-typescript.mdc'),
  )?.rule
  assert.deepEqual(rule?.metadata, { alwaysApply: false, globs: [] })
  assert.equal(rule?.body, raw)
  assert.equal(result.diagnostics.length, 1)
  assert.equal(result.diagnostics[0].code, 'invalid-frontmatter')
  assert.equal(result.diagnostics[0].source, projectRule('20-typescript.mdc'))
})

test('a read permission failure remains inspectable and does not stop other rules loading', () => {
  const target = projectRule('20-typescript.mdc')
  const result = projectOnly({
    readFileSync: ((file: fs.PathOrFileDescriptor, encoding: 'utf8') => {
      if (slash(String(file)) === target) throw fileError('EACCES', 'Rule read denied')
      return fs.readFileSync(file, encoding)
    }) as typeof fs.readFileSync,
  })
  const failed = result.observations.find((item) => item.realPath === target)
  assert.equal(failed?.error, 'Rule read denied')
  assert.equal(failed?.rule, undefined)
  assert.equal(result.observations.filter((item) => item.rule).length, 2)
  assert.deepEqual(result.diagnostics, [
    {
      severity: 'warning',
      code: 'read-failed',
      source: target,
      message: 'Rule read denied',
    },
  ])
  assert.equal(result.stats.reads, 3)
  assert.equal(result.stats.parses, 2)
})

test('a file removed between enumeration and reading is absent rather than retained as unreadable', () => {
  const target = projectRule('20-typescript.mdc')
  const result = projectOnly({
    readFileSync: ((file: fs.PathOrFileDescriptor, encoding: 'utf8') => {
      if (slash(String(file)) === target) throw fileError('ENOENT', 'Rule vanished')
      return fs.readFileSync(file, encoding)
    }) as typeof fs.readFileSync,
  })
  assert.deepEqual(
    result.observations.map((item) => item.realPath),
    [projectRule('10-general.mdc'), projectRule('nested/30-markdown.mdc')],
  )
  assert.equal(result.diagnostics[0]?.code, 'read-failed')
  assert.equal(result.diagnostics[0]?.source, target)
})

test('directory scan failures are reported without throwing or losing the global source', () => {
  const result = discoverRules({
    ...options,
    fs: {
      ...fs,
      globSync: ((pattern: string | readonly string[], scanOptions: fs.GlobOptionsWithFileTypes) => {
        if (slash(String(scanOptions.cwd)) === slash(join(projectRoot, '.pi/rules'))) {
          throw fileError('EACCES', 'Project scan denied')
        }
        return fs.globSync(pattern, scanOptions)
      }) as unknown as typeof fs.globSync,
    },
  })
  assert.equal(result.observations.length, 2)
  assert.ok(result.observations.every((item) => item.isGlobal))
  assert.deepEqual(result.diagnostics, [
    {
      severity: 'warning',
      code: 'scan-failed',
      source: slash(join(projectRoot, '.pi/rules')),
      message: 'Project scan denied',
    },
  ])
})

test('project rule sources resolving outside the physical session boundary are rejected', () => {
  const source = slash(join(projectRoot, '.pi/rules'))
  const result = projectOnly({
    realpathSync: ((file: fs.PathLike) => {
      if (slash(String(file)) === source) return slash(join(homeDir, '.pi/rules'))
      return fs.realpathSync(file)
    }) as typeof fs.realpathSync,
  })
  assert.deepEqual(result.observations, [])
  assert.equal(result.stats.scans, 0)
  assert.equal(result.diagnostics[0]?.code, 'outside-project')
  assert.equal(result.diagnostics[0]?.source, source)
})

test('individual project rules resolving outside the session boundary are rejected', () => {
  const escaped = projectRule('20-typescript.mdc')
  const result = projectOnly({
    realpathSync: ((file: fs.PathLike) => {
      if (slash(String(file)) === escaped) return globalRule('15-global-typescript.mdc')
      return fs.realpathSync(file)
    }) as typeof fs.realpathSync,
  })
  assert.deepEqual(
    result.observations.map((item) => item.realPath),
    [projectRule('10-general.mdc'), projectRule('nested/30-markdown.mdc')],
  )
  assert.equal(result.diagnostics[0]?.code, 'outside-project')
  assert.equal(result.diagnostics[0]?.source, escaped)
})

test('known candidates cannot bypass source containment, extension, depth or excluded-directory checks', () => {
  const invalidPaths = [
    join(projectRoot, 'outside.mdc'),
    projectRule('ignored.txt'),
    projectRule('node_modules/hidden.mdc'),
    projectRule('a/b/c/d/e/f/g/h/i/j/k/deep.mdc'),
  ]
  const known: RuleCandidate[] = invalidPaths.map((file) => ({
    discoveredPath: slash(file),
    realPath: slash(file),
    source: '.pi/rules',
    relativePath: 'unused',
    isGlobal: false,
  }))
  const result = discoverRules({ ...options, allowlist: ['.pi/rules'] }, known)
  assert.equal(result.observations.length, 3)
  assert.equal(result.stats.reads, 3)
  assert.deepEqual(
    result.diagnostics.map((item) => item.code),
    ['scan-depth-limit'],
  )
})

test('discovery does not follow directory symlinks returned by filesystem enumeration', () => {
  const directoryLink = {
    name: 'linked.mdc',
    parentPath: slash(join(projectRoot, '.pi/rules')),
    isFile: () => false,
    isDirectory: () => false,
    isSymbolicLink: () => true,
  } as fs.Dirent
  const linkedPath = projectRule('linked.mdc')
  const result = projectOnly({
    globSync: (() => [directoryLink]) as unknown as typeof fs.globSync,
    lstatSync: ((file, statOptions) =>
      slash(String(file)) === linkedPath
        ? directoryLink
        : fs.lstatSync(file, statOptions)) as typeof fs.lstatSync,
    realpathSync: ((file: fs.PathLike) =>
      slash(String(file)) === linkedPath
        ? projectRoot
        : fs.realpathSync(file)) as typeof fs.realpathSync,
  })
  assert.deepEqual(result.observations, [])
  assert.equal(result.stats.reads, 0)
  assert.deepEqual(result.diagnostics, [])
})
