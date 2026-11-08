import assert from 'node:assert/strict'
import { test } from 'node:test'

import { RuleMatcher } from '../src/rules/matcher.ts'
import type { LoadedRule } from '../src/rules/types.ts'

function rule(overrides: Partial<LoadedRule> = {}): LoadedRule {
  const path = overrides.isGlobal
    ? '/home/user/.pi/rules/typescript.md'
    : '/project/.pi/rules/typescript.md'
  return {
    discoveredPath: path,
    realPath: path,
    source: overrides.isGlobal ? '~/.pi/rules' : '.pi/rules',
    relativePath: 'typescript.md',
    isGlobal: false,
    metadata: { alwaysApply: false, globs: ['*.ts'] },
    body: 'Use strict types.',
    contentHash: 'typescript-content',
    ruleKey: 'typescript-rule',
    ...overrides,
  }
}

test('project rules cannot cross the session boundary even with alwaysApply', () => {
  const matcher = new RuleMatcher()
  const projectRule = rule({ metadata: { alwaysApply: true, globs: ['*.ts'] } })

  assert.deepEqual(matcher.match(projectRule, '/elsewhere/file.ts', '/project', false), {
    diagnostics: [],
  })
})

test('alwaysApply applies inside the project without compiling unused globs', () => {
  const matcher = new RuleMatcher()
  const projectRule = rule({ metadata: { alwaysApply: true, globs: ['['] } })

  assert.deepEqual(matcher.match(projectRule, '/project/file.js', '/project', true), {
    reason: 'alwaysApply',
    diagnostics: [],
  })
})

test('global alwaysApply rules can apply outside the session root', () => {
  const matcher = new RuleMatcher()
  const globalRule = rule({ isGlobal: true, metadata: { alwaysApply: true, globs: [] } })

  assert.deepEqual(matcher.match(globalRule, '/elsewhere/file.js', '/project', false), {
    reason: 'alwaysApply',
    diagnostics: [],
  })
})

for (const { name, patterns, target, inside, global, expected } of [
  {
    name: 'project rules match paths relative to the session root',
    patterns: ['src/**/*.ts'],
    target: '/project/src/nested/file.ts',
    inside: true,
    global: false,
    expected: 'src/**/*.ts',
  },
  {
    name: 'project rules also match nested target basenames',
    patterns: ['*.ts'],
    target: '/project/src/nested/file.ts',
    inside: true,
    global: false,
    expected: '*.ts',
  },
  {
    name: 'global rules use session-relative paths for inside targets',
    patterns: ['src/**/*.ts'],
    target: '/project/src/file.ts',
    inside: true,
    global: true,
    expected: 'src/**/*.ts',
  },
  {
    name: 'global rules match outside basenames',
    patterns: ['*.ts'],
    target: '/elsewhere/src/file.ts',
    inside: false,
    global: true,
    expected: '*.ts',
  },
  {
    name: 'global rules do not use outside target directory paths',
    patterns: ['**/src/*.ts'],
    target: '/elsewhere/src/file.ts',
    inside: false,
    global: true,
    expected: undefined,
  },
  {
    name: 'outside matching does not expose parent traversal from the session root',
    patterns: ['../elsewhere/**/*.ts'],
    target: '/elsewhere/src/file.ts',
    inside: false,
    global: true,
    expected: undefined,
  },
  {
    name: 'the first matching positive pattern determines the reason',
    patterns: ['*.js', 'src/**/*.ts', '*.ts'],
    target: '/project/src/file.ts',
    inside: true,
    global: false,
    expected: 'src/**/*.ts',
  },
  {
    name: 'a relative-path exclusion vetoes a basename match',
    patterns: ['*.ts', '!src/private/**'],
    target: '/project/src/private/file.ts',
    inside: true,
    global: false,
    expected: undefined,
  },
  {
    name: 'a basename exclusion vetoes a relative-path match',
    patterns: ['src/**/*.ts', '!*.test.ts'],
    target: '/project/src/file.test.ts',
    inside: true,
    global: false,
    expected: undefined,
  },
  {
    name: 'exclusions do not veto unrelated files',
    patterns: ['src/**/*.ts', '!*.test.ts'],
    target: '/project/src/file.ts',
    inside: true,
    global: false,
    expected: 'src/**/*.ts',
  },
  {
    name: 'negative patterns alone never include a file',
    patterns: ['!*.test.ts'],
    target: '/project/src/file.ts',
    inside: true,
    global: false,
    expected: undefined,
  },
  {
    name: 'a leading negative extglob is a positive include pattern',
    patterns: ['!(*.test).ts'],
    target: '/project/src/file.ts',
    inside: true,
    global: false,
    expected: '!(*.test).ts',
  },
  {
    name: 'a leading negative extglob rejects its excluded alternative',
    patterns: ['!(*.test).ts'],
    target: '/project/src/file.test.ts',
    inside: true,
    global: false,
    expected: undefined,
  },
  {
    name: 'brace alternatives and extglobs are compiled by the real matcher',
    patterns: ['src/@(index|main).{ts,tsx}'],
    target: '/project/src/main.tsx',
    inside: true,
    global: false,
    expected: 'src/@(index|main).{ts,tsx}',
  },
  {
    name: 'extension matching remains case-sensitive',
    patterns: ['*.ts'],
    target: '/project/src/file.TS',
    inside: true,
    global: false,
    expected: undefined,
  },
  {
    name: 'directory matching remains case-sensitive',
    patterns: ['src/**/*.ts'],
    target: '/project/SRC/file.ts',
    inside: true,
    global: false,
    expected: undefined,
  },
  {
    name: 'wildcards include dotfile basenames',
    patterns: ['*.ts'],
    target: '/project/src/.hidden.ts',
    inside: true,
    global: false,
    expected: '*.ts',
  },
  {
    name: 'globstars include dot directories',
    patterns: ['src/**/*.ts'],
    target: '/project/src/.hidden/file.ts',
    inside: true,
    global: false,
    expected: 'src/**/*.ts',
  },
  {
    name: 'empty glob metadata never matches implicitly',
    patterns: [],
    target: '/project/src/file.ts',
    inside: true,
    global: false,
    expected: undefined,
  },
]) {
  test(name, () => {
    const matcher = new RuleMatcher()
    const candidate = rule({ isGlobal: global, metadata: { alwaysApply: false, globs: patterns } })
    const result = matcher.match(candidate, target, '/project', inside)

    assert.equal(result.reason, expected)
    assert.deepEqual(result.diagnostics, [])
  })
}

test('slash-normalized Windows paths retain session-relative matching', () => {
  const matcher = new RuleMatcher()
  const candidate = rule({ metadata: { alwaysApply: false, globs: ['src/*.ts'] } })

  assert.deepEqual(matcher.match(candidate, 'D:/project/src/file.ts', 'D:/project', true), {
    reason: 'src/*.ts',
    diagnostics: [],
  })
})

for (const pattern of ['[', '![', '@(unclosed']) {
  test(`invalid pattern ${JSON.stringify(pattern)} fails closed despite a matching include`, () => {
    const matcher = new RuleMatcher()
    const candidate = rule({ metadata: { alwaysApply: false, globs: ['*.ts', pattern] } })
    const result = matcher.match(candidate, '/project/src/file.ts', '/project', true)

    assert.equal(result.reason, undefined)
    assert.equal(result.diagnostics.length, 1)
    assert.equal(result.diagnostics[0].severity, 'warning')
    assert.equal(result.diagnostics[0].code, 'invalid-glob')
    assert.equal(result.diagnostics[0].source, '/project/.pi/rules/typescript.md')
    assert.ok(result.diagnostics[0].message.startsWith(`Invalid glob ${JSON.stringify(pattern)}:`))
  })
}

test('invalid-glob diagnostics use the current alias and remain isolated between calls', () => {
  const matcher = new RuleMatcher()
  const candidate = rule({ metadata: { alwaysApply: false, globs: ['*.ts', '!['] } })
  const first = matcher.match(candidate, '/project/src/file.ts', '/project', true)

  assert.equal(first.reason, undefined)
  assert.equal(first.diagnostics.length, 1)
  assert.equal(first.diagnostics[0].source, '/project/.pi/rules/typescript.md')
  assert.match(first.diagnostics[0].message, /^Invalid glob "!\[":/)

  first.diagnostics[0].message = 'poisoned'
  first.diagnostics[0].source = 'poisoned'
  first.diagnostics.push({
    severity: 'warning',
    code: 'poisoned',
    source: 'poisoned',
    message: 'poisoned',
  })
  first.reason = 'poisoned'

  const alias = rule({ ...candidate, discoveredPath: '/project/.pi/rules/alias.md' })
  const second = matcher.match(alias, '/project/src/file.ts', '/project', true)

  assert.equal(second.reason, undefined)
  assert.equal(second.diagnostics.length, 1)
  assert.equal(second.diagnostics[0].code, 'invalid-glob')
  assert.equal(second.diagnostics[0].source, '/project/.pi/rules/alias.md')
  assert.match(second.diagnostics[0].message, /^Invalid glob "!\[":/)
  assert.notStrictEqual(second.diagnostics[0], first.diagnostics[0])
})

test('compilation errors are attributed to each distinct rule', () => {
  const matcher = new RuleMatcher()
  const first = rule({ metadata: { alwaysApply: false, globs: ['!['] } })
  const other = rule({
    ...first,
    ruleKey: 'another-rule',
    discoveredPath: '/project/.pi/rules/other.md',
  })

  const firstResult = matcher.match(first, '/project/file.ts', '/project', true)
  firstResult.diagnostics[0].message = 'poisoned'
  const otherResult = matcher.match(other, '/project/file.ts', '/project', true)

  assert.equal(otherResult.reason, undefined)
  assert.equal(otherResult.diagnostics.length, 1)
  assert.equal(otherResult.diagnostics[0].code, 'invalid-glob')
  assert.equal(otherResult.diagnostics[0].source, '/project/.pi/rules/other.md')
  assert.match(otherResult.diagnostics[0].message, /^Invalid glob "!\[":/)
})

test('matches remain specific to the target, root, and inside status', () => {
  const matcher = new RuleMatcher()
  const candidate = rule({ isGlobal: true, metadata: { alwaysApply: false, globs: ['src/*.ts'] } })

  assert.deepEqual(matcher.match(candidate, '/project/src/file.ts', '/project', true), {
    reason: 'src/*.ts',
    diagnostics: [],
  })
  assert.deepEqual(matcher.match(candidate, '/project/src/file.ts', '/project/src', true), {
    diagnostics: [],
  })
  assert.deepEqual(matcher.match(candidate, '/project/src/other.js', '/project', true), {
    diagnostics: [],
  })
  assert.deepEqual(matcher.match(candidate, '/project/src/file.ts', '/project', false), {
    diagnostics: [],
  })
})
