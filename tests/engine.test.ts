import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { RulesEngine } from '../src/rules/engine.ts'
import type { EngineOptions } from '../src/rules/engine.ts'
import {
  fileError,
  globalRule,
  homeDir,
  overlayFileSystem,
  projectRoot,
  projectRule,
} from './helpers/fixtures.ts'

function engineForProject(options: EngineOptions = {}): RulesEngine {
  const engine = new RulesEngine({ homeDir, env: {}, allowlist: ['.pi/rules'], ...options })
  engine.startSession(projectRoot)
  return engine
}

function activePaths(engine: RulesEngine): string[] {
  return engine.snapshot.activated.map((rule) => rule.relativePath)
}

function requestPaths(engine: RulesEngine): string[] {
  return engine.formatRequest().included.map(({ rule }) => rule.relativePath)
}

test('session startup injects only always-apply rules before any edit', () => {
  const engine = engineForProject()
  assert.deepEqual(requestPaths(engine), ['.pi/rules/10-general.mdc'])
  assert.match(engine.formatRequest().text, /Project instructions\./)
  assert.deepEqual(activePaths(engine), [])
  assert.deepEqual([...engine.snapshot.injected], [])
})

test('matching edits activate rules once and retain first-activation order across later targets', () => {
  const engine = engineForProject()
  engine.activateTargets(['README.md', './README.md'], projectRoot)
  engine.activateTargets(['src/main.ts', 'src/main.ts'], projectRoot)
  engine.activateTargets(['src/other.ts'], projectRoot)

  assert.deepEqual(activePaths(engine), [
    '.pi/rules/10-general.mdc',
    '.pi/rules/nested/30-markdown.mdc',
    '.pi/rules/20-typescript.mdc',
  ])
  assert.deepEqual(requestPaths(engine), [
    '.pi/rules/10-general.mdc',
    '.pi/rules/nested/30-markdown.mdc',
    '.pi/rules/20-typescript.mdc',
  ])
  const matched = engine.snapshot.known.find(
    (rule) => rule.realPath === projectRule('20-typescript.mdc'),
  )
  assert.equal(matched?.matchReason, 'src/**/*.ts')
  assert.deepEqual(matched?.targets, ['src/other.ts'])
})

test('exclusions prevent activation and a nonmatching later edit does not deactivate earlier rules', () => {
  const engine = engineForProject()
  engine.activateTargets(['src/main.test.ts'], projectRoot)
  assert.deepEqual(activePaths(engine), ['.pi/rules/10-general.mdc'])
  engine.activateTargets(['src/main.ts'], projectRoot)
  engine.activateTargets(['image.png'], projectRoot)
  assert.deepEqual(activePaths(engine), ['.pi/rules/10-general.mdc', '.pi/rules/20-typescript.mdc'])
  assert.match(engine.formatRequest().text, /TypeScript instructions\./)
})

test('relative edit paths use the current working directory, not the session root', () => {
  const engine = engineForProject()
  // Missing directories must still resolve through their existing physical parent.
  engine.activateTargets(['main.ts'], join(projectRoot, 'src'))
  assert.deepEqual(activePaths(engine), ['.pi/rules/10-general.mdc', '.pi/rules/20-typescript.mdc'])
  const matched = engine.snapshot.known.find(
    (rule) => rule.realPath === projectRule('20-typescript.mdc'),
  )
  assert.deepEqual(matched?.targets, ['main.ts'])
})

test('outside-project edits activate only global rules and match them by basename', () => {
  const engine = engineForProject({ allowlist: ['.pi/rules', '~/.pi/rules'] })
  engine.activateTargets([join(homeDir, 'elsewhere.ts')], projectRoot)
  assert.deepEqual(
    engine.snapshot.activated.map((rule) => rule.realPath),
    [globalRule('05-global.mdc'), globalRule('15-global-typescript.mdc')],
  )
})

for (const [mode, expected] of [
  ['static', ['.pi/rules/10-general.mdc']],
  ['dynamic', ['.pi/rules/10-general.mdc', '.pi/rules/20-typescript.mdc']],
  ['both', ['.pi/rules/10-general.mdc', '.pi/rules/20-typescript.mdc']],
  ['off', []],
] as const) {
  test(`${mode} mode chooses the appropriate static and activated groups`, () => {
    const engine = engineForProject()
    engine.activateTargets(['src/main.ts'], projectRoot)
    engine.syncFlags({ mode })
    assert.deepEqual(requestPaths(engine), expected)
  })
}

test('dynamic mode has no initial instructions until a target activates a rule', () => {
  const engine = engineForProject()
  engine.syncFlags({ mode: 'dynamic' })
  assert.equal(engine.formatRequest().text, '')
  engine.activateTargets(['src/main.ts'], projectRoot)
  assert.match(engine.formatRequest().text, /TypeScript instructions\./)
})

for (const flags of [{ disabled: true }, { mode: 'off' }]) {
  test(`${JSON.stringify(flags)} pauses new activation and injection without losing active rules`, () => {
    const engine = engineForProject()
    engine.activateTargets(['src/main.ts'], projectRoot)
    engine.syncFlags(flags)
    engine.activateTargets(['README.md'], projectRoot)
    assert.deepEqual(activePaths(engine), [
      '.pi/rules/10-general.mdc',
      '.pi/rules/20-typescript.mdc',
    ])
    assert.equal(engine.formatRequest().text, '')
    engine.commitInjection(engine.formatRequest())
    assert.equal(engine.snapshot.injected.size, 0)
    engine.syncFlags({ disabled: false, mode: 'both' })
    assert.match(engine.formatRequest().text, /TypeScript instructions\./)
    assert.doesNotMatch(engine.formatRequest().text, /Markdown instructions\./)
  })
}

test('native context files suppress duplicate instructions only for the current preparation', () => {
  const engine = engineForProject()
  engine.activateTargets(['src/main.ts'], projectRoot)
  engine.prepareAgent([projectRule('10-general.mdc'), '.pi/rules/20-typescript.mdc'])
  assert.equal(engine.formatRequest().text, '')
  assert.equal(engine.snapshot.activated.length, 2)
  engine.prepareAgent([])
  assert.deepEqual(requestPaths(engine), ['.pi/rules/10-general.mdc', '.pi/rules/20-typescript.mdc'])
})

test('formatting does not claim injection until the request is committed', () => {
  const engine = engineForProject({ env: { PI_RULES_MAX_RULE_CHARS: '1' } })
  engine.activateTargets(['src/main.ts'], projectRoot)
  const result = engine.formatRequest()
  assert.equal(engine.snapshot.injected.size, 0)
  assert.equal(result.included.length, 0)
  assert.equal(result.omitted.length, 2)
  engine.commitInjection(result)
  assert.equal(engine.snapshot.injected.size, 0)
  assert.deepEqual(
    engine.snapshot.diagnostics.formatting.map((item) => item.code),
    ['rule-omitted', 'rule-omitted'],
  )
})

test('committed injection identifies the included content versions', () => {
  const engine = engineForProject()
  engine.activateTargets(['src/main.ts'], projectRoot)
  const result = engine.formatRequest()
  engine.commitInjection(result)
  assert.deepEqual(
    [...engine.snapshot.injected],
    result.included.map(({ rule }) => rule.ruleKey),
  )
  assert.equal(engine.snapshot.injected.size, 2)
})

test('inspection reports current matches without activating or replacing the request contents', () => {
  const contents = new Map<string, string | Error>()
  const engine = engineForProject({ fs: overlayFileSystem(contents) })
  engine.activateTargets(['src/main.ts'], projectRoot)
  contents.set(projectRule('20-typescript.mdc'), '---\nglobs: "*.ts"\n---\nChanged on disk.')
  const inspected = engine.inspect()
  assert.equal(
    inspected.known.find((item) => item.realPath === projectRule('20-typescript.mdc'))?.rule?.body,
    'Changed on disk.',
  )
  assert.match(engine.formatRequest().text, /TypeScript instructions\./)
  assert.doesNotMatch(engine.formatRequest().text, /Changed on disk/)
  const fresh = engineForProject()
  fresh.inspect()
  assert.deepEqual(activePaths(fresh), [])
})

test('reload updates active content in place, removes missing rules, and resets injection bookkeeping', () => {
  const contents = new Map<string, string | Error>()
  const engine = engineForProject({ fs: overlayFileSystem(contents) })
  engine.activateTargets(['README.md'], projectRoot)
  engine.activateTargets(['src/main.ts'], projectRoot)
  engine.commitInjection(engine.formatRequest())
  contents.set(projectRule('20-typescript.mdc'), '---\nglobs: "*.ts"\n---\nUpdated TypeScript.')
  contents.set(projectRule('nested/30-markdown.mdc'), fileError('ENOENT', 'Removed fixture'))

  assert.deepEqual(engine.reload(), { updated: 1, removed: 1 })
  assert.deepEqual(activePaths(engine), ['.pi/rules/10-general.mdc', '.pi/rules/20-typescript.mdc'])
  assert.match(engine.formatRequest().text, /Updated TypeScript\./)
  assert.doesNotMatch(engine.formatRequest().text, /Markdown instructions\./)
  assert.equal(engine.snapshot.injected.size, 0)
  assert.deepEqual(engine.snapshot.diagnostics.formatting, [])
  assert.deepEqual(engine.snapshot.diagnostics.inspection, [])
  assert.ok(
    engine.snapshot.warnings.some(
      (item) => item.code === 'read-failed' && item.source === projectRule('nested/30-markdown.mdc'),
    ),
  )
})

test('prepareAgent refreshes changed disk content while preserving active order', () => {
  const contents = new Map<string, string | Error>()
  const engine = engineForProject({ fs: overlayFileSystem(contents) })
  engine.activateTargets(['README.md', 'src/main.ts'], projectRoot)
  const before = activePaths(engine)
  contents.set(projectRule('20-typescript.mdc'), '---\nglobs: "*.ts"\n---\nRefreshed body.')
  engine.prepareAgent([])
  assert.deepEqual(activePaths(engine), before)
  assert.match(engine.formatRequest().text, /Refreshed body\./)
})

test('a new session resets activations, native suppression, injection, and transient diagnostics', () => {
  const engine = engineForProject()
  engine.activateTargets(['src/main.ts'], projectRoot)
  engine.commitInjection(engine.formatRequest())
  engine.prepareAgent([projectRule('10-general.mdc')])
  engine.setUIDiagnostic(new Error('UI unavailable'))
  const identity = engine.sessionIdentity
  engine.startSession(projectRoot)
  assert.equal(engine.sessionIdentity, identity + 1)
  assert.deepEqual(activePaths(engine), [])
  assert.equal(engine.snapshot.injected.size, 0)
  assert.deepEqual(engine.snapshot.warnings, [])
  assert.deepEqual(requestPaths(engine), ['.pi/rules/10-general.mdc'])
})

test('mutating a snapshot collection does not change engine bookkeeping', () => {
  const engine = engineForProject()
  engine.activateTargets(['src/main.ts'], projectRoot)
  engine.commitInjection(engine.formatRequest())
  const snapshot = engine.snapshot
  snapshot.config.disabled = true
  ;(snapshot.activated as unknown[]).length = 0
  ;(snapshot.injected as Set<string>).clear()
  assert.equal(engine.snapshot.config.disabled, false)
  assert.equal(engine.snapshot.activated.length, 2)
  assert.equal(engine.snapshot.injected.size, 2)
})

test('unreadable activated files stop contributing stale instructions after reload', () => {
  const contents = new Map<string, string | Error>()
  const engine = engineForProject({ fs: overlayFileSystem(contents) })
  engine.activateTargets(['src/main.ts'], projectRoot)
  contents.set(projectRule('20-typescript.mdc'), fileError('EACCES', 'Permission revoked'))
  assert.deepEqual(engine.reload(), { updated: 0, removed: 1 })
  assert.doesNotMatch(engine.formatRequest().text, /TypeScript instructions\./)
  assert.equal(
    engine.snapshot.known.find((item) => item.discoveredPath === projectRule('20-typescript.mdc'))
      ?.error,
    'Permission revoked',
  )
  assert.ok(engine.snapshot.warnings.some((item) => item.message === 'Permission revoked'))
})

test('a failed session-root resolution reports the filesystem error without producing instructions', () => {
  const error = fileError('EACCES', 'Session root denied')
  const engine = new RulesEngine({
    homeDir,
    env: {},
    fs: {
      ...fs,
      realpathSync: (() => {
        throw error
      }) as unknown as typeof fs.realpathSync,
    },
  })
  engine.startSession(projectRoot)
  engine.activateTargets(['src/main.ts'], projectRoot)
  engine.prepareAgent([])
  assert.equal(engine.inspect().sessionRoot, '')
  assert.equal(engine.formatRequest().text, '')
  assert.deepEqual(engine.snapshot.warnings, [
    {
      severity: 'warning',
      code: 'read-failed',
      source: projectRoot,
      message: 'Session root denied',
    },
  ])
})

test('a failed target does not prevent other targets in the edit batch from activating rules', () => {
  const inaccessible = join(projectRoot, 'private.ts')
  const engine = engineForProject({
    fs: {
      ...fs,
      realpathSync: ((file: fs.PathLike) => {
        if (String(file) === inaccessible) throw fileError('EACCES', 'Target denied')
        return fs.realpathSync(file)
      }) as typeof fs.realpathSync,
    },
  })
  engine.activateTargets(['private.ts', 'src/main.ts'], projectRoot)
  assert.deepEqual(activePaths(engine), ['.pi/rules/10-general.mdc', '.pi/rules/20-typescript.mdc'])
  assert.ok(engine.snapshot.warnings.some((item) => item.message === 'Target denied'))
})

test('repeated matcher diagnostics across targets are deduplicated for inspection and status', () => {
  const contents = new Map([
    [projectRule('20-typescript.mdc'), '---\nglobs: ["*.ts", "!["]\n---\nInvalid exclusion.'],
  ])
  const engine = engineForProject({ fs: overlayFileSystem(contents) })
  engine.activateTargets(['src/main.ts', 'src/other.ts'], projectRoot)
  assert.deepEqual(activePaths(engine), ['.pi/rules/10-general.mdc'])
  assert.deepEqual(
    engine.snapshot.warnings.map((item) => [item.code, item.source]),
    [['invalid-glob', projectRule('20-typescript.mdc')]],
  )
  engine.inspect()
  assert.equal(engine.snapshot.warnings.length, 1)
})

test('environment settings are captured on construction and cannot be overridden by later mutation', () => {
  const env = { PI_RULES_DISABLED: 'true' }
  const engine = engineForProject({ env })
  env.PI_RULES_DISABLED = 'false'
  engine.syncFlags({ disabled: false })
  engine.activateTargets(['src/main.ts'], projectRoot)
  assert.equal(engine.formatRequest().text, '')
  assert.deepEqual(activePaths(engine), [])
})
