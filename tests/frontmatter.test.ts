import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseFrontmatter } from '../src/rules/frontmatter.ts'

const source = '/project/.pi/rules/style.md'

test('a document without frontmatter keeps its content after removing the BOM', () => {
  assert.deepEqual(parseFrontmatter('\uFEFF# Instructions\r\nKeep this.\r\n', source), {
    metadata: { alwaysApply: false, globs: [] },
    body: '# Instructions\r\nKeep this.\r\n',
    diagnostics: [],
  })
})

test('frontmatter requires a delimiter at the very beginning of the document', () => {
  assert.deepEqual(parseFrontmatter('\n---\nalwaysApply: true\n---\nBody', source), {
    metadata: { alwaysApply: false, globs: [] },
    body: '\n---\nalwaysApply: true\n---\nBody',
    diagnostics: [],
  })
})

test('BOM and CRLF frontmatter are removed without changing body line endings', () => {
  assert.deepEqual(
    parseFrontmatter(
      '\uFEFF---\r\nalwaysApply: true\r\nglobs: src/**/*.ts\r\n---\r\n# Body\r\n\r\nKeep me.\r\n',
      source,
    ),
    {
      metadata: { alwaysApply: true, globs: ['src/**/*.ts'] },
      body: '# Body\r\n\r\nKeep me.\r\n',
      diagnostics: [],
    },
  )
})

test('a closing delimiter at EOF leaves an empty body', () => {
  assert.deepEqual(parseFrontmatter('---\nalwaysApply: false\n---', source), {
    metadata: { alwaysApply: false, globs: [] },
    body: '',
    diagnostics: [],
  })
})

test('unknown fields are opaque even when their quotes and nested known fields are malformed', () => {
  const raw = [
    '---',
    'extension: "unclosed [',
    '  alwaysApply: true',
    '  globs: [',
    '  description: false',
    '# a comment within the unknown value',
    '',
    'another-extension: {invalid: yaml',
    'description: Actual description',
    'globs: *.ts',
    '---',
    'Body',
  ].join('\n')

  assert.deepEqual(parseFrontmatter(raw, source), {
    metadata: { alwaysApply: false, description: 'Actual description', globs: ['*.ts'] },
    body: 'Body',
    diagnostics: [],
  })
})

for (const { name, field, expected } of [
  {
    name: 'JSON-quoted descriptions decode escapes and preserve quoted hashes',
    field: 'description: "Line\\n\\"quoted\\" #tag" # discarded',
    expected: 'Line\n"quoted" #tag',
  },
  {
    name: 'single-quoted descriptions decode doubled apostrophes',
    field: "description: 'Don''t drop #tags' # discarded",
    expected: "Don't drop #tags",
  },
  {
    name: 'plain descriptions discard inline comments',
    field: 'description: Keep it simple # discarded',
    expected: 'Keep it simple',
  },
  {
    name: 'quoted non-string spellings remain strings',
    field: 'description: "false"',
    expected: 'false',
  },
]) {
  test(name, () => {
    assert.deepEqual(parseFrontmatter(`---\n${field}\n---\nBody`, source), {
      metadata: { alwaysApply: false, description: expected, globs: [] },
      body: 'Body',
      diagnostics: [],
    })
  })
}

for (const { name, fields, globs } of [
  {
    name: 'comma-separated globs retain commas within braces and extglobs',
    fields: 'globs: src\\**\\*.{ts,tsx}, @(alpha,beta).js, docs/**/*.md',
    globs: ['src/**/*.{ts,tsx}', '@(alpha,beta).js', 'docs/**/*.md'],
  },
  {
    name: 'quoted scalar globs still split top-level commas',
    fields: 'globs: "*.ts, *.tsx, src/{one,two}.js"',
    globs: ['*.ts', '*.tsx', 'src/{one,two}.js'],
  },
  {
    name: 'inline arrays preserve commas within quoted items and allow a trailing comma',
    fields: 'globs: ["file,with,commas.ts", \'src/{a,b}.ts\', "@(a,b).js",] # ignored',
    globs: ['file,with,commas.ts', 'src/{a,b}.ts', '@(a,b).js'],
  },
  {
    name: 'indented arrays allow comments and preserve each item as a single glob',
    fields: "globs:\n  - '*.ts'\n\n  # comment\n  - 'a,b.js'\n  - src/**/*.tsx # comment",
    globs: ['*.ts', 'a,b.js', 'src/**/*.tsx'],
  },
  {
    name: 'normalization trims, converts separators, drops empty globs, and deduplicates',
    fields: "globs: [' src\\**\\*.ts ', 'src/**/*.ts', '', '  ']\nglobs: *.js, *.js,",
    globs: ['src/**/*.ts', '*.js'],
  },
  {
    name: 'an empty inline array is valid metadata',
    fields: 'globs: []',
    globs: [],
  },
]) {
  test(name, () => {
    assert.deepEqual(parseFrontmatter(`---\n${fields}\n---\nBody`, source), {
      metadata: { alwaysApply: false, globs },
      body: 'Body',
      diagnostics: [],
    })
  })
}

for (const { name, field, error } of [
  { name: 'quoted booleans', field: 'alwaysApply: "true"', error: /unquoted boolean/ },
  { name: 'uppercase booleans', field: 'alwaysApply: TRUE', error: /unquoted boolean/ },
  { name: 'numeric descriptions', field: 'description: 42', error: /string value/ },
  { name: 'null descriptions', field: 'description: null', error: /string value/ },
  { name: 'boolean descriptions', field: 'description: false', error: /string value/ },
  { name: 'mapping descriptions', field: 'description: {key: value}', error: /string value/ },
  { name: 'block scalars', field: 'description: |', error: /string value/ },
  { name: 'invalid JSON escapes', field: 'description: "bad\\q"', error: /JSON-quoted string/ },
  { name: 'unclosed quotes', field: "description: 'broken", error: /Unclosed quoted string/ },
  {
    name: 'text after a quoted string',
    field: "description: 'fine' trailing",
    error: /Unexpected text after a quoted string/,
  },
  { name: 'unclosed arrays', field: 'globs: ["*.ts"', error: /Unclosed array/ },
  { name: 'numeric glob items', field: 'globs: ["*.ts", 42]', error: /string value/ },
  { name: 'empty interior array items', field: 'globs: ["*.ts",, "*.js"]', error: /string value/ },
  {
    name: 'a missing glob list',
    field: 'globs:\n# only a comment',
    error: /string or string array/,
  },
  {
    name: 'inconsistent list indentation',
    field: 'globs:\n  - *.ts\n    - *.js',
    error: /indented string list/,
  },
  {
    name: 'nested mappings in glob lists',
    field: 'globs:\n  nested: *.ts',
    error: /indented string list/,
  },
  { name: 'a non-field top-level line', field: 'not a field', error: /top-level field/ },
]) {
  test(`malformed metadata is all-or-nothing for ${name}`, () => {
    const raw = `---\nalwaysApply: true\ndescription: Valid description\nglobs: *.md\n${field}\n---\nOriginal body`
    const result = parseFrontmatter(raw, source)

    assert.deepEqual(result.metadata, { alwaysApply: false, globs: [] })
    assert.equal(result.body, raw)
    assert.equal(result.diagnostics.length, 1)
    assert.equal(result.diagnostics[0].severity, 'warning')
    assert.equal(result.diagnostics[0].code, 'invalid-frontmatter')
    assert.equal(result.diagnostics[0].source, source)
    assert.match(result.diagnostics[0].message, error)
  })
}

test('an unterminated frontmatter block preserves the BOM-free document and warns', () => {
  const result = parseFrontmatter('\uFEFF---\nalwaysApply: true\nBody', source)

  assert.deepEqual(result, {
    metadata: { alwaysApply: false, globs: [] },
    body: '---\nalwaysApply: true\nBody',
    diagnostics: [
      {
        severity: 'warning',
        code: 'invalid-frontmatter',
        source,
        message: 'Invalid frontmatter: Missing closing delimiter.',
      },
    ],
  })
})
