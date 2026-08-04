import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Repo } from '../../shared/types'
import { createFlowNodeDiffStatCollector } from './flow-node-diff-stat'

const repo = { id: 'repo-1', path: '/repo' } as Repo
const getRepo = (): Repo => repo

let worktreePath = ''

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: worktreePath, stdio: 'ignore' })
}

beforeAll(() => {
  worktreePath = mkdtempSync(path.join(tmpdir(), 'orca-flow-diff-'))
  git('init', '-q')
  git('config', 'user.email', 'test@orca.dev')
  git('config', 'user.name', 'Orca Test')
  writeFileSync(path.join(worktreePath, 'kept.txt'), 'one\ntwo\n')
  git('add', '.')
  git('commit', '-qm', 'base')
})

afterAll(() => {
  rmSync(worktreePath, { recursive: true, force: true })
})

function collect(): Promise<unknown> {
  return createFlowNodeDiffStatCollector(getRepo)({
    workspaceId: `repo-1::${worktreePath}`
  })
}

describe('createFlowNodeDiffStatCollector', () => {
  it('returns null when nothing changed', async () => {
    await expect(collect()).resolves.toBeNull()
  })

  it('counts modified tracked files and new untracked ones', async () => {
    writeFileSync(path.join(worktreePath, 'kept.txt'), 'one\ntwo\nthree\n')
    writeFileSync(path.join(worktreePath, 'new.txt'), 'a\nb\n')
    await expect(collect()).resolves.toEqual({
      filesChanged: 2,
      insertions: 3,
      deletions: 0
    })
  })

  it('skips workspaces it cannot measure locally', async () => {
    const collector = createFlowNodeDiffStatCollector(
      () => ({ ...repo, connectionId: 'ssh-1' }) as Repo
    )
    await expect(collector({ workspaceId: `repo-1::${worktreePath}` })).resolves.toBeNull()
    await expect(collector({ workspaceId: null })).resolves.toBeNull()
  })
})
