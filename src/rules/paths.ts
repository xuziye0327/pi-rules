import * as nodeFs from 'node:fs'
import path from 'node:path'

import type { RuleFileSystem } from './types.ts'

export function slash(input: string): string {
  return input.replaceAll('\\', '/')
}

export function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export function physicalPath(input: string, cwd: string, fs: RuleFileSystem = nodeFs): string {
  let current = path.resolve(cwd, input)
  const missing: string[] = []

  for (;;) {
    try {
      return slash(path.resolve(fs.realpathSync(current), ...missing))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
      const parent = path.dirname(current)
      if (parent === current) throw error
      missing.unshift(path.basename(current))
      current = parent
    }
  }
}
