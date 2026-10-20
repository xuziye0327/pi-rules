import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { isWithin, physicalPath, slash } from '../src/rules/paths.ts'
import { fileError, projectRoot, projectRule } from './helpers/fixtures.ts'

for (const [name, target, expected] of [
  ['root itself', projectRoot, true],
  ['nested child', join(projectRoot, 'src/main.ts'), true],
  ['parent directory', dirname(projectRoot), false],
  ['sibling sharing the root prefix', `${projectRoot}-other/file.ts`, false],
  ['normalized traversal outside the root', join(projectRoot, '../outside.ts'), false],
] as const) {
  test(`containment handles ${name}`, () => {
    assert.equal(isWithin(projectRoot, target), expected)
  })
}

test('physical paths retain nonexistent descendant segments under the canonical existing ancestor', () => {
  assert.equal(physicalPath('new/src/main.ts', projectRoot), `${projectRoot}/new/src/main.ts`)
  assert.equal(
    physicalPath('.pi/rules/../rules/10-general.mdc', projectRoot),
    projectRule('10-general.mdc'),
  )
})

test('physical paths resolve parent aliases before appending a new file path', () => {
  const alias = join(dirname(projectRoot), 'project-alias')
  const aliasFileSystem = {
    ...fs,
    realpathSync: ((file: fs.PathLike) => {
      const input = String(file)
      if (input === alias) return projectRoot
      if (input.startsWith(`${alias}/`) || input.startsWith(`${alias}\\`)) {
        throw fileError('ENOENT', 'New alias descendant')
      }
      return fs.realpathSync(file)
    }) as typeof fs.realpathSync,
  }
  assert.equal(physicalPath('new/main.ts', alias, aliasFileSystem), `${projectRoot}/new/main.ts`)
})

test('permission errors are propagated rather than treated as missing path segments', () => {
  const error = fileError('EACCES', 'Cannot resolve private directory')
  assert.throws(
    () =>
      physicalPath('private/file.ts', projectRoot, {
        ...fs,
        realpathSync: (() => {
          throw error
        }) as unknown as typeof fs.realpathSync,
      }),
    (caught) => caught === error,
  )
})

test('an entirely unresolvable filesystem terminates at the root with its missing-path error', () => {
  const error = fileError('ENOENT', 'No filesystem root')
  assert.throws(
    () =>
      physicalPath('missing/file.ts', projectRoot, {
        ...fs,
        realpathSync: (() => {
          throw error
        }) as unknown as typeof fs.realpathSync,
      }),
    (caught) => caught === error,
  )
})

test('slash normalization preserves Unicode and network path separators', () => {
  assert.equal(slash('\\\\server\\share\\规则\\file.ts'), '//server/share/规则/file.ts')
})
