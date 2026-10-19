import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import {
  DefaultPackageManager,
  discoverAndLoadExtensions,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'

const exec = promisify(execFile)
const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const sdkEntry = import.meta.resolve('@earendil-works/pi-coding-agent')
const cliPath = fileURLToPath(new URL('./bundle/cli.js', sdkEntry))

function isolatedEnvironment() {
  const env = { ...process.env }
  const path = (process.env.PATH ?? '')
    .split(delimiter)
    .filter((entry) => !/node_modules[/\\]\.bin[/\\]?$/i.test(entry))
    .join(delimiter)

  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path') delete env[key]
  }
  env.PATH = path
  delete env.NODE_ENV
  delete env.HUSKY
  return env
}

async function sourceFixture(t: TestContext) {
  const tempRoot = join(projectRoot, '.agent-temp')
  await mkdir(tempRoot, { recursive: true })
  const root = await mkdtemp(join(tempRoot, 'install-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const repository = join(root, 'repository')
  await mkdir(repository)
  for (const name of ['package.json', 'bun.lock', 'src', '.husky']) {
    await cp(join(projectRoot, name), join(repository, name), {
      recursive: true,
      filter: (path) => path !== join(projectRoot, '.husky', '_'),
    })
  }
  await exec('git', ['init', '--quiet'], { cwd: repository })
  return { root, repository }
}

test('pi Git installation loads TypeScript source without dist or development dependencies', async (t) => {
  const { root, repository } = await sourceFixture(t)
  await exec('git', ['add', '.'], { cwd: repository })
  await exec(
    'git',
    [
      '-c',
      `core.hooksPath=${join(root, 'disabled-hooks')}`,
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=Pi Rules Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'Installation fixture',
    ],
    { cwd: repository },
  )

  const cwd = join(root, 'workspace')
  const agentDir = join(root, 'agent')
  await mkdir(cwd)
  await mkdir(agentDir)
  await writeFile(
    join(agentDir, 'settings.json'),
    JSON.stringify({ npmCommand: ['bun'], enableInstallTelemetry: false, enableAnalytics: false }),
  )

  const remote = 'https://example.invalid/pi-rules/install-fixture'
  const source = `git:${remote}`
  await exec(process.execPath, [cliPath, 'install', source], {
    cwd,
    env: {
      ...isolatedEnvironment(),
      PI_CODING_AGENT_DIR: agentDir,
      PI_OFFLINE: '1',
      GIT_ALLOW_PROTOCOL: 'file',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.${pathToFileURL(repository).href}.insteadOf`,
      GIT_CONFIG_VALUE_0: remote,
    },
  })

  const manager = new DefaultPackageManager({
    cwd,
    agentDir,
    settingsManager: SettingsManager.create(cwd, agentDir),
  })
  const installed = manager.getInstalledPath(source, 'user')
  assert.ok(installed, 'pi must install the Git source into its managed checkout')
  assert.equal(existsSync(join(installed, 'dist')), false)
  assert.equal(existsSync(join(installed, 'node_modules', 'husky')), false)
  assert.equal(
    existsSync(join(installed, 'node_modules', '@earendil-works', 'pi-coding-agent')),
    false,
  )
  assert.equal(existsSync(join(installed, '.husky', '_')), false)

  const resources = await manager.resolveExtensionSources([installed])
  const paths = resources.extensions.filter((entry) => entry.enabled).map((entry) => entry.path)
  assert.deepEqual(paths, [join(installed, 'src', 'index.ts')])
  const loaded = await discoverAndLoadExtensions(paths, cwd, agentDir)
  assert.deepEqual(loaded.errors, [])
  assert.deepEqual(
    loaded.extensions.map((entry) => entry.path),
    paths,
  )
})

test('development preparation installs real Husky hooks when its local dependency is present', async (t) => {
  const { repository } = await sourceFixture(t)
  await cp(join(projectRoot, 'node_modules', 'husky'), join(repository, 'node_modules', 'husky'), {
    recursive: true,
  })
  await exec('bun', ['run', 'prepare'], {
    cwd: repository,
    env: { ...isolatedEnvironment(), NODE_ENV: 'development' },
  })

  const { stdout } = await exec('git', ['config', '--local', '--get', 'core.hooksPath'], {
    cwd: repository,
  })
  assert.equal(stdout.trim(), '.husky/_')
  assert.equal(existsSync(join(repository, '.husky', '_', 'pre-commit')), true)
})

for (const [name, overrides] of [
  ['production', { NODE_ENV: 'production' }],
  ['HUSKY=0', { HUSKY: '0' }],
] as const) {
  test(`preparation leaves hooks untouched for ${name} even when Husky is installed`, async (t) => {
    const { repository } = await sourceFixture(t)
    await cp(join(projectRoot, 'node_modules', 'husky'), join(repository, 'node_modules', 'husky'), {
      recursive: true,
    })
    await exec(process.execPath, ['.husky/install.mjs'], {
      cwd: repository,
      env: { ...isolatedEnvironment(), ...overrides },
    })
    assert.equal(existsSync(join(repository, '.husky', '_')), false)
  })
}
