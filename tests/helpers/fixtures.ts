import * as fs from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { slash } from '../../src/rules/paths.ts'
import type { RuleFileSystem } from '../../src/rules/types.ts'

// Checked-in fixtures keep filesystem tests independent of host rules and writable temp directories.
export const projectRoot = slash(
  fs.realpathSync(fileURLToPath(new URL('../fixtures/project/', import.meta.url))),
)
export const homeDir = slash(
  fs.realpathSync(fileURLToPath(new URL('../fixtures/home/', import.meta.url))),
)
export const projectRule = (name: string): string => slash(join(projectRoot, '.pi/rules', name))
export const globalRule = (name: string): string => slash(join(homeDir, '.pi/rules', name))

export function fileError(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code })
}

/** Overlay only disk contents/errors; directory discovery and path resolution remain real. */
export function overlayFileSystem(contents: Map<string, string | Error>): RuleFileSystem {
  return {
    globSync: fs.globSync,
    realpathSync: fs.realpathSync,
    statSync: fs.statSync,
    lstatSync: ((file, options) => {
      const replacement = contents.get(slash(String(file)))
      if (replacement instanceof Error) throw replacement
      return fs.lstatSync(file, options)
    }) as typeof fs.lstatSync,
    readFileSync: ((file: fs.PathOrFileDescriptor, options: 'utf8') => {
      const replacement = contents.get(slash(String(file)))
      if (replacement instanceof Error) throw replacement
      if (replacement !== undefined) {
        assertUtf8(options)
        return replacement
      }
      return fs.readFileSync(file, options)
    }) as typeof fs.readFileSync,
  }
}

function assertUtf8(options: unknown): asserts options is 'utf8' {
  if (options !== 'utf8') throw new Error('The rule loader must request UTF-8 text')
}
