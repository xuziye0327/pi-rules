import type { Diagnostic, RuleMetadata } from './types.ts'

class FrontmatterError extends Error {}

function emptyMetadata(): RuleMetadata {
  return { alwaysApply: false, globs: [] }
}

/** Parse only the supported rule metadata; malformed metadata never partially applies. */
export function parseFrontmatter(
  raw: string,
  source: string,
): { metadata: RuleMetadata; body: string; diagnostics: Diagnostic[] } {
  const text = raw.startsWith('\uFEFF') ? raw.slice(1) : raw
  const lines = text.split('\n')
  if (lines[0].replace(/\r$/, '') !== '---') {
    return { metadata: emptyMetadata(), body: text, diagnostics: [] }
  }

  try {
    const closing = lines.findIndex((line, index) => index > 0 && line.replace(/\r$/, '') === '---')
    if (closing < 0) throw new FrontmatterError('Missing closing delimiter.')
    const metadata = parseFields(lines.slice(1, closing).map((line) => line.replace(/\r$/, '')))
    const bodyStart = lines
      .slice(0, closing + 1)
      .reduce((offset, line) => offset + line.length + 1, 0)
    return { metadata, body: text.slice(bodyStart), diagnostics: [] }
  } catch (error) {
    if (!(error instanceof FrontmatterError)) throw error
    return {
      metadata: emptyMetadata(),
      body: text,
      diagnostics: [
        {
          severity: 'warning',
          code: 'invalid-frontmatter',
          source,
          message: `Invalid frontmatter: ${error.message}`,
        },
      ],
    }
  }
}

function parseFields(lines: readonly string[]): RuleMetadata {
  const metadata = emptyMetadata()
  const patterns: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (isBlankOrComment(line)) continue
    const field = /^([^\s:]+)[ \t]*:(.*)$/.exec(line)
    if (!field) throw new FrontmatterError('Expected a top-level field.')
    const [, key, rawValue] = field

    if (key !== 'alwaysApply' && key !== 'description' && key !== 'globs') {
      // Unknown values are opaque, including malformed quotes and nested known keys.
      while (
        index + 1 < lines.length &&
        (isBlankOrComment(lines[index + 1]) || /^[ \t]/.test(lines[index + 1]))
      ) {
        index += 1
      }
      continue
    }

    const value = withoutComment(rawValue).trim()
    if (key === 'alwaysApply') {
      if (value !== 'true' && value !== 'false')
        throw new FrontmatterError('alwaysApply must be an unquoted boolean.')
      metadata.alwaysApply = value === 'true'
    } else if (key === 'description') {
      metadata.description = parseString(value)
    } else if (value !== '') {
      patterns.push(...parseGlobs(value))
    } else {
      const items: string[] = []
      let indentation: string | undefined
      while (index + 1 < lines.length) {
        const next = lines[index + 1]
        if (isBlankOrComment(next)) {
          index += 1
          continue
        }
        if (!/^[ \t]/.test(next)) break
        const item = /^([ \t]+)-[ \t]+(.*)$/.exec(next)
        if (!item || (indentation !== undefined && item[1] !== indentation)) {
          throw new FrontmatterError('globs must contain an indented string list.')
        }
        indentation = item[1]
        items.push(parseString(withoutComment(item[2]).trim(), true))
        index += 1
      }
      if (items.length === 0) throw new FrontmatterError('globs must be a string or string array.')
      patterns.push(...items)
    }
  }

  metadata.globs = [
    ...new Set(patterns.map((pattern) => pattern.replace(/\\/g, '/').trim()).filter(Boolean)),
  ]
  return metadata
}

function isBlankOrComment(line: string): boolean {
  return /^\s*(?:#.*)?$/.test(line)
}

function parseGlobs(value: string): string[] {
  if (!value.startsWith('[')) {
    // Quotes describe the scalar, not its comma-delimited patterns.
    return lexValue(parseString(value, true), { quotes: false })
  }
  if (!value.endsWith(']')) throw new FrontmatterError('Unclosed globs array.')
  const inner = value.slice(1, -1)
  if (inner.trim() === '') return []
  const items = lexValue(inner)
  // A single trailing comma is allowed in the inline array.
  if (items.at(-1)?.trim() === '') items.pop()
  return items.map((item) => parseString(item.trim(), true))
}

function parseString(value: string, glob = false): string {
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value) as string
    } catch {
      throw new FrontmatterError('Invalid JSON-quoted string.')
    }
  }
  if (value.startsWith("'")) {
    let decoded = ''
    for (let index = 1; index < value.length; index += 1) {
      if (value[index] !== "'") {
        decoded += value[index]
      } else if (value[index + 1] === "'") {
        decoded += "'"
        index += 1
      } else {
        if (index !== value.length - 1)
          throw new FrontmatterError('Unexpected text after a quoted string.')
        return decoded
      }
    }
    throw new FrontmatterError('Unclosed single-quoted string.')
  }

  const nonString =
    /^(?:true|false|null|~|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?|[-+]?0[xob][\da-f]+)$/i
  if (
    value === '' ||
    nonString.test(value) ||
    value.startsWith('[') ||
    (value.startsWith('{') && (!glob || value === '{}' || value.includes(':'))) ||
    /^[|>]/.test(value)
  ) {
    throw new FrontmatterError('Expected a string value.')
  }
  return value
}

function withoutComment(value: string): string {
  return lexValue(value, { comments: true }).join(',')
}

/** Split only top-level commas, with a finite quote/comment/delimiter scanner. */
function lexValue(
  value: string,
  { comments = false, quotes = true }: { comments?: boolean; quotes?: boolean } = {},
): string[] {
  const parts: string[] = []
  let start = 0
  let end = value.length
  let quote = ''
  let tokenStart = true
  let square = 0
  let brace = 0
  let paren = 0

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quote === '"') {
      if (char === '\\') index += 1
      else if (char === '"') quote = ''
      continue
    }
    if (quote === "'") {
      if (char === "'" && value[index + 1] === "'") index += 1
      else if (char === "'") quote = ''
      continue
    }
    if (comments && char === '#') {
      end = index
      break
    }
    if (quotes && tokenStart && (char === '"' || char === "'")) {
      quote = char
      tokenStart = false
      continue
    }
    if (char === '[') square += 1
    else if (char === ']') square = Math.max(0, square - 1)
    else if (char === '{') brace += 1
    else if (char === '}') brace = Math.max(0, brace - 1)
    else if (char === '(') paren += 1
    else if (char === ')') paren = Math.max(0, paren - 1)
    else if (char === ',' && square === 0 && brace === 0 && paren === 0) {
      parts.push(value.slice(start, index))
      start = index + 1
    }
    if (!/\s/.test(char)) tokenStart = char === ',' || char === '['
  }

  if (quote !== '') throw new FrontmatterError('Unclosed quoted string.')
  if (square !== 0) throw new FrontmatterError('Unclosed array or bracket expression.')
  parts.push(value.slice(start, end))
  return parts
}
