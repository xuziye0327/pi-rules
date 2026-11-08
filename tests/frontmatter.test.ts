import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseFrontmatter } from '../src/rules/frontmatter.ts'

const source = '/project/.pi/rules/style.md'

test('missing metadata uses inactive rule defaults', () => {
  assert.deepEqual(parseFrontmatter('Body', source), {
    metadata: { alwaysApply: false, globs: [] },
    body: 'Body',
    diagnostics: [],
  })
})

test('rule metadata selects known fields and normalizes glob arrays', () => {
  const raw = [
    '---',
    'alwaysApply: true',
    'description: TypeScript rules',
    "globs: [' src\\**\\*.ts ', 'src/**/*.ts', '', '!**/*.test.ts']",
    'extension: {alwaysApply: false}',
    '---',
    'Body',
  ].join('\n')

  assert.deepEqual(parseFrontmatter(raw, source), {
    metadata: {
      alwaysApply: true,
      description: 'TypeScript rules',
      globs: ['src/**/*.ts', '!**/*.test.ts'],
    },
    body: 'Body',
    diagnostics: [],
  })
})

test('a scalar glob remains one pattern including its commas', () => {
  assert.deepEqual(parseFrontmatter('---\nglobs: "*.ts,*.tsx"\n---\nBody', source), {
    metadata: { alwaysApply: false, globs: ['*.ts,*.tsx'] },
    body: 'Body',
    diagnostics: [],
  })
})

for (const fields of [
  '[]',
  'alwaysApply: "true"',
  'description: 42',
  'globs: 42',
  'alwaysApply: true\nglobs: ["*.ts", 42]',
]) {
  test(`invalid rule metadata ${JSON.stringify(fields)} falls back as a whole`, () => {
    const raw = `---\n${fields}\n---\nBody`
    const result = parseFrontmatter(raw, source)

    assert.deepEqual(result.metadata, { alwaysApply: false, globs: [] })
    assert.equal(result.body, raw)
    assert.equal(result.diagnostics[0]?.code, 'invalid-frontmatter')
  })
}

test('repeated parser failures preserve the document and report the current source', () => {
  const raw = '---\nalwaysApply: true\nglobs: [broken\n---\nBody'

  for (const path of [source, '/project/.pi/rules/alias.md']) {
    const result = parseFrontmatter(raw, path)

    assert.deepEqual(result.metadata, { alwaysApply: false, globs: [] })
    assert.equal(result.body, raw)
    assert.deepEqual(
      result.diagnostics.map(({ severity, code, source }) => ({ severity, code, source })),
      [{ severity: 'warning', code: 'invalid-frontmatter', source: path }],
    )
  }
})

for (const language of ['javascript', 'js']) {
  test(`${language} content stays inactive and is not executed`, (t) => {
    const execution = t.mock.method(console, 'info', () => {})
    const raw = `---${language}\n(console.info('Executed'), { alwaysApply: true })\n---\nBody`
    const result = parseFrontmatter(raw, source)

    assert.equal(execution.mock.callCount(), 0)
    assert.deepEqual(result, {
      metadata: { alwaysApply: false, globs: [] },
      body: raw,
      diagnostics: [],
    })
  })
}
