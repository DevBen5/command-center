import { test } from '@japa/runner'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { extname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const ROOT_CLAUDE = 'Read and follow `AGENTS.md` before working in this repository.\n'
const MODULE_CLAUDE = 'Read and follow `AGENTS.md` before working in this module.\n'

function modules(): string[] {
  return readdirSync(`${ROOT}app/modules`, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`
    const projectPath = relative(ROOT, path).replaceAll('\\', '/')

    if (entry.isDirectory()) {
      if (
        [
          '.claude',
          '.git',
          '.kilo',
          'build',
          'node_modules',
          'public',
          'skill-observations',
        ].includes(entry.name) ||
        projectPath === '.agents/skills/task-observer'
      ) {
        return []
      }

      return files(path)
    }

    return (['.css', '.js', '.json', '.md', '.ts', '.vue', '.yml'].includes(extname(entry.name)) ||
      entry.name.startsWith('.env')) &&
      projectPath !== '.env'
      ? [path]
      : []
  })
}

test.group('Documentation / guides des agents', () => {
  test('Claude Code charge le guide racine canonique sans le dupliquer', ({ assert }) => {
    assert.equal(readFileSync(`${ROOT}CLAUDE.md`, 'utf8'), ROOT_CLAUDE)
    assert.isTrue(existsSync(`${ROOT}AGENTS.md`))
    assert.isTrue(existsSync(`${ROOT}docs/agent-reference.md`))
    assert.isAtMost(
      readFileSync(`${ROOT}AGENTS.md`, 'utf8').split('\n').length,
      80,
      'AGENTS.md racine doit rester un contrat universel compact'
    )
  })

  test('chaque module possède un guide AGENTS et un pointeur Claude minimal', ({ assert }) => {
    const missing = modules().flatMap((module) => {
      const directory = `${ROOT}app/modules/${module}`
      const failures: string[] = []

      if (!existsSync(`${directory}/AGENTS.md`)) failures.push(`${module}/AGENTS.md absent`)
      if (readFileSync(`${directory}/CLAUDE.md`, 'utf8') !== MODULE_CLAUDE) {
        failures.push(`${module}/CLAUDE.md doit uniquement pointer vers AGENTS.md`)
      }

      return failures
    })

    assert.deepEqual(missing, [])
  })

  test('aucun renvoi documentaire ne cible les anciens guides Claude', ({ assert }) => {
    const offenders = files(ROOT)
      .map((path) => relative(ROOT, path).replaceAll('\\', '/'))
      .filter((path) => path !== 'tests/unit/agent_guides.spec.ts')
      .filter((path) => readFileSync(`${ROOT}${path}`, 'utf8').includes('CLAUDE.md'))

    assert.deepEqual(offenders, [])
  })
})
