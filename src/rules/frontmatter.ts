import frontMatter from 'front-matter'

import type { Diagnostic, RuleMetadata } from './types.ts'

class FrontmatterError extends Error {}

function emptyMetadata(): RuleMetadata {
  return { alwaysApply: false, globs: [] }
}

/** Parse rule metadata; malformed metadata never partially applies. */
export function parseFrontmatter(
  raw: string,
  source: string,
): { metadata: RuleMetadata; body: string; diagnostics: Diagnostic[] } {
  try {
    const { attributes, body } = frontMatter<unknown>(raw)
    return { metadata: parseMetadata(attributes), body, diagnostics: [] }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      metadata: emptyMetadata(),
      body: raw,
      diagnostics: [
        {
          severity: 'warning',
          code: 'invalid-frontmatter',
          source,
          message: `Invalid frontmatter: ${message}`,
        },
      ],
    }
  }
}

function parseMetadata(value: unknown): RuleMetadata {
  if (!isMapping(value)) throw new FrontmatterError('Rule metadata must be a mapping.')
  const metadata = emptyMetadata()
  if (Object.hasOwn(value, 'alwaysApply')) {
    if (typeof value.alwaysApply !== 'boolean')
      throw new FrontmatterError('alwaysApply must be a boolean.')
    metadata.alwaysApply = value.alwaysApply
  }
  if (Object.hasOwn(value, 'description')) {
    if (typeof value.description !== 'string')
      throw new FrontmatterError('description must be a string.')
    metadata.description = value.description
  }
  if (Object.hasOwn(value, 'globs')) metadata.globs = normalizeGlobs(value.globs)
  return metadata
}

function isMapping(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function normalizeGlobs(value: unknown): string[] {
  const patterns = typeof value === 'string' ? [value] : value
  if (
    !Array.isArray(patterns) ||
    !patterns.every((pattern: unknown): pattern is string => typeof pattern === 'string')
  ) {
    throw new FrontmatterError('globs must be a string or string array.')
  }
  return [
    ...new Set(patterns.map((pattern) => pattern.replaceAll('\\', '/').trim()).filter(Boolean)),
  ]
}
