import { expect, test } from '@playwright/test'
import { createHostFixture } from '../support/host-fixture.mjs'

test('real workbench creates an empty project without AI and survives host restart', async ({ page, request }) => {
  const host = await createHostFixture()
  try {
    let baseURL = await host.start()
    await page.goto(baseURL)
    await page.getByRole('button', { name: '打开交付工作台' }).click()
    await expect(page.locator('.po-workbench')).toBeFocused()
    await page.getByRole('button', { name: /^项目/ }).click()
    await expect(page.getByText('还没有项目')).toBeVisible()

    await page.getByRole('button', { name: '新建项目' }).click()
    await page.getByLabel('项目名称').fill('持久化空项目')
    await page.getByRole('button', { name: '选择目录' }).click()
    await page.getByRole('button', { name: '创建空项目' }).click()
    await expect(page.getByText('持久化空项目', { exact: true })).toBeVisible()
    await expect(page.getByText('这是一个空项目')).toBeVisible()
    const operational = page.getByRole('region', { name: '项目当前结论' })
    await expect(operational).toContainText('尚未开始规划')
    await expect(operational).toContainText('检查准备条件')
    await expect(operational.getByRole('region', { name: '规划准备' })).toContainText('没有可自动分派的项目成员')
    await expect(operational.getByRole('region', { name: '执行准备' })).toContainText('尚无当前计划快照')

    const metrics = await request.get(`${baseURL}/_test/metrics`).then((response) => response.json())
    expect(metrics).toMatchObject({ agentCreateCalls: 0, modelResolveCalls: 0, apiSnapshotCalls: 0, projectCount: 1 })
    expect(metrics.apiBootstrapCalls).toBeGreaterThan(0)
    const snapshot = await request.get(`${baseURL}/project-orchestrator/api/snapshot`).then((response) => response.json())
    expect(snapshot.projects).toHaveLength(1)
    expect(snapshot.projects[0]).toMatchObject({ name: '持久化空项目', status: 'draft', taskIds: [] })

    await page.reload()
    await page.getByRole('button', { name: '打开交付工作台' }).click()
    await page.getByRole('button', { name: /^项目/ }).click()
    await expect(page.getByText('持久化空项目', { exact: true })).toBeVisible()

    await page.getByText('持久化空项目', { exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('.po-mobile-nav')).toBeVisible()
    await expect(page.locator('.po-sidebar')).toBeHidden()
    await expect(page.getByRole('region', { name: '项目当前结论' })).toBeVisible()
    const horizontalOverflow = await page.locator('.po-project-detail-page').evaluate((element) => element.scrollWidth - element.clientWidth)
    expect(horizontalOverflow).toBeLessThanOrEqual(1)
    await page.keyboard.press('Escape')
    await expect(page.locator('.po-workbench')).toBeHidden()

    await host.stop()
    baseURL = await host.start()
    await page.goto(baseURL)
    await page.getByRole('button', { name: '打开交付工作台' }).click()
    await page.getByRole('button', { name: /^项目/ }).click()
    await expect(page.getByText('持久化空项目', { exact: true })).toBeVisible()
    const restarted = await request.get(`${baseURL}/_test/metrics`).then((response) => response.json())
    expect(restarted).toMatchObject({ agentCreateCalls: 0, modelResolveCalls: 0, apiSnapshotCalls: 0, projectCount: 1 })
    expect(restarted.apiBootstrapCalls).toBeGreaterThan(0)
  } finally {
    await host.cleanup()
  }
})

test('real workbench refuses automatic storage recovery when preview requires manual handling', async ({ page }) => {
  const host = await createHostFixture()
  try {
    const baseURL = await host.start()
    await page.route('**/project-orchestrator/api/projects/*/overview', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projectId: 'project', projectRevision: 1, status: 'draft', conclusionCode: 'storage_reconciliation_required', nextAction: { code: 'reconcile_storage', subjectId: 'intent-manual' }, blockers: [{ code: 'storage-needs-reconciliation', subjectIds: ['intent-manual'] }], counts: { tasks: 0, activeTaskRuns: 0, failedTaskRuns: 0, passedEvidence: 0, failedEvidence: 0, unresolvedIntents: 1, pendingDecisions: 0 }, updatedAt: '2026-09-22T00:00:00.000Z' }) })
    })
    await page.route('**/project-orchestrator/api/projects/*/readiness', async (route) => {
      const check = { code: 'storage_consistent', status: 'blocked', phase: 'planning', reason: 'Storage requires reconciliation.', subjectIds: ['intent-manual'], actionCode: 'reconcile_storage' }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projectId: 'project', projectRevision: 1, checkedAt: '2026-09-22T00:00:00.000Z', planningReadiness: { status: 'blocked', checks: [check] }, executionPreparation: { status: 'blocked', checks: [{ ...check, phase: 'execution' }] } }) })
    })
    await page.route('**/project-orchestrator/api/admin/storage-reconciliation**', async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.endsWith('/preview')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ intentId: 'intent-manual', intentDigest: 'a'.repeat(64), observedStateDigest: 'b'.repeat(64), projectRevision: 1, expectedProjectPointerDigest: 'c'.repeat(64), verdict: 'manual_required', allowedActions: [], steps: [{ stepId: 'project-pointer', actual: 'diverged' }], reasons: [{ code: 'reconciliation_project_pointer_diverged', subjectIds: ['project'] }], previewDigest: 'd'.repeat(64) }) })
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'intent-manual', projectId: 'project', status: 'needs_reconciliation', intentDigest: 'a'.repeat(64) }]) })
      }
    })

    await page.goto(baseURL)
    await page.getByRole('button', { name: '打开交付工作台' }).click()
    await page.getByRole('button', { name: /^项目/ }).click()
    await page.getByRole('button', { name: '新建项目' }).click()
    await page.getByLabel('项目名称').fill('恢复门禁项目')
    await page.getByRole('button', { name: '选择目录' }).click()
    await page.getByRole('button', { name: '创建空项目' }).click()

    const recovery = page.getByRole('region', { name: '存储恢复预检' })
    await expect(recovery).toContainText('需要人工处理')
    await expect(recovery).toContainText('自动恢复已禁用')
    await expect(recovery.getByRole('button', { name: '确认已完成' })).toHaveCount(0)
    await expect(recovery.getByRole('button', { name: '补写剩余记录' })).toHaveCount(0)
    await expect(recovery.getByRole('button', { name: '撤销候选写入' })).toHaveCount(0)
  } finally {
    await host.cleanup()
  }
})

test('real workbench submits only the recovery action authorized by the current preview', async ({ page }) => {
  const host = await createHostFixture()
  let recovered = false
  let submitted
  try {
    const baseURL = await host.start()
    await page.route('**/project-orchestrator/api/projects/*/overview', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projectId: 'project', projectRevision: 1, status: 'draft', conclusionCode: recovered ? 'planning_not_started' : 'storage_reconciliation_required', nextAction: recovered ? { code: 'inspect_readiness' } : { code: 'reconcile_storage', subjectId: 'intent-replay' }, blockers: recovered ? [] : [{ code: 'storage-needs-reconciliation', subjectIds: ['intent-replay'] }], counts: { tasks: 0, activeTaskRuns: 0, failedTaskRuns: 0, passedEvidence: 0, failedEvidence: 0, unresolvedIntents: recovered ? 0 : 1, pendingDecisions: 0 }, updatedAt: '2026-09-22T00:00:00.000Z' }) })
    })
    await page.route('**/project-orchestrator/api/projects/*/readiness', async (route) => {
      const status = recovered ? 'ready' : 'blocked'
      const check = { code: 'storage_consistent', status, phase: 'planning', reason: recovered ? 'Storage is consistent.' : 'Storage requires reconciliation.', subjectIds: recovered ? [] : ['intent-replay'], ...(recovered ? {} : { actionCode: 'reconcile_storage' }) }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projectId: 'project', projectRevision: 1, checkedAt: '2026-09-22T00:00:00.000Z', planningReadiness: { status, checks: [check] }, executionPreparation: { status, checks: [{ ...check, phase: 'execution' }] } }) })
    })
    await page.route('**/project-orchestrator/api/admin/storage-reconciliation**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() === 'POST') {
        submitted = request.postDataJSON()
        recovered = true
        await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ id: 'attempt-replay', intentId: 'intent-replay', projectId: 'project', intentDigest: 'a'.repeat(64), previewDigest: 'd'.repeat(64), observedStateDigest: 'b'.repeat(64), action: 'replay', idempotencyKey: submitted.idempotencyKey, requestDigest: 'e'.repeat(64), status: 'completed', completedStepIds: ['project-pointer'], result: 'committed', requestedBy: submitted.requestedBy, reason: submitted.reason, createdAt: '2026-09-22T00:00:00.000Z', completedAt: '2026-09-22T00:00:01.000Z' }) })
      } else if (url.pathname.endsWith('/preview')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ intentId: 'intent-replay', intentDigest: 'a'.repeat(64), observedStateDigest: 'b'.repeat(64), projectRevision: 1, expectedProjectPointerDigest: 'c'.repeat(64), verdict: 'replay_safe', allowedActions: ['replay'], steps: [{ stepId: 'project-pointer', actual: 'before' }], reasons: [], previewDigest: 'd'.repeat(64) }) })
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(recovered ? [] : [{ id: 'intent-replay', projectId: 'project', status: 'needs_reconciliation', intentDigest: 'a'.repeat(64) }]) })
      }
    })

    await page.goto(baseURL)
    await page.getByRole('button', { name: '打开交付工作台' }).click()
    await page.getByRole('button', { name: /^项目/ }).click()
    await page.getByRole('button', { name: '新建项目' }).click()
    await page.getByLabel('项目名称').fill('自动恢复项目')
    await page.getByRole('button', { name: '选择目录' }).click()
    await page.getByRole('button', { name: '创建空项目' }).click()

    const recovery = page.getByRole('region', { name: '存储恢复预检' })
    await expect(recovery).toContainText('可以安全补写')
    await expect(recovery.getByRole('button', { name: '补写剩余记录' })).toBeVisible()
    await expect(recovery.getByRole('button', { name: '确认已完成' })).toHaveCount(0)
    await expect(recovery.getByRole('button', { name: '撤销候选写入' })).toHaveCount(0)
    await recovery.getByRole('button', { name: '补写剩余记录' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '补写剩余记录' }).click()

    await expect(page.getByRole('region', { name: '存储恢复预检' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: '项目当前结论' })).toContainText('尚未开始规划')
    expect(submitted).toMatchObject({ expectedIntentDigest: 'a'.repeat(64), previewDigest: 'd'.repeat(64), expectedProjectRevision: 1, action: 'replay', requestedBy: '项目负责人', reason: '根据当前预检结果恢复项目存储状态。' })
    expect(submitted.idempotencyKey).toContain('workbench:intent-replay:')
  } finally {
    await host.cleanup()
  }
})

test('real workbench keeps the last snapshot visible when refresh fails', async ({ page }) => {
  const host = await createHostFixture()
  try {
    const baseURL = await host.start()
    await page.goto(baseURL)
    await page.getByRole('button', { name: '打开交付工作台' }).click()
    await page.getByRole('button', { name: /^项目/ }).click()
    await expect(page.getByText('还没有项目')).toBeVisible()

    await page.route('**/project-orchestrator/api/events*', async (route) => {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'test-unavailable', message: '测试存储暂不可用。' } }) })
    })
    await page.getByRole('button', { name: '刷新数据' }).click()
    await expect(page.getByRole('status')).toContainText('测试存储暂不可用。')
    await expect(page.getByText('还没有项目')).toBeVisible()
  } finally {
    await host.cleanup()
  }
})

test('real workbench paginates Project TaskRun history without gaps or duplicates', async ({ page }) => {
  const host = await createHostFixture({ taskRunSeedCount: 75 })
  try {
    const baseURL = await host.start()
    await page.goto(baseURL)
    await page.getByRole('button', { name: '打开交付工作台' }).click()
    await page.getByRole('button', { name: /^项目/ }).click()
    await page.getByText('分页运行历史项目', { exact: true }).click()
    await page.getByRole('button', { name: '运行与证据' }).click()

    const runs = page.locator('.po-run-disclosure')
    await expect(runs).toHaveCount(50)
    await expect(page.getByText('50+ 次 TaskRun · 0 份 Artifact')).toBeVisible()
    await expect(runs.first()).toContainText('TaskRun run-0074')

    await page.getByRole('button', { name: '加载更多运行记录' }).click()

    await expect(runs).toHaveCount(75)
    await expect(page.getByText('75 次 TaskRun · 0 份 Artifact')).toBeVisible()
    await expect(page.getByRole('button', { name: '加载更多运行记录' })).toHaveCount(0)
    const labels = await runs.locator('summary strong').allTextContents()
    expect(new Set(labels).size).toBe(75)
    expect(labels[0]).toContain('run-0074')
    expect(labels.at(-1)).toContain('run-0000')
    await runs.first().locator('summary').click()
    await runs.first().getByRole('button', { name: 'fixture-session-74', exact: true }).click()
    await expect(page.locator('body')).toHaveAttribute('data-opened-session', 'fixture-session-74')
    await expect(page.locator('.po-workbench')).toBeHidden()
  } finally {
    await host.cleanup()
  }
})

test('real Issue dialog distinguishes loaded evidence from full Issue totals', async ({ page, request }) => {
  const host = await createHostFixture({ issueEvidenceSeedCount: 101 })
  try {
    const baseURL = await host.start()
    await page.goto(baseURL)
    await page.getByRole('button', { name: '打开交付工作台' }).click()
    await page.getByRole('button', { name: /^Issues/ }).click()
    await page.getByRole('button', { name: 'Issue 证据总数 Issue' }).click()

    const issue = page.locator('.po-issue-detail')
    await expect(issue.locator('h3').filter({ hasText: 'Transcript' })).toContainText('100/101 条')
    await expect(issue.locator('h3').filter({ hasText: 'Artifacts' })).toContainText('200/303 个')
    await expect(issue.locator('h3').filter({ hasText: '当前运行与历史' })).toContainText('101 次')
    const snapshot = await request.get(`${baseURL}/project-orchestrator/api/snapshot`).then((response) => response.json())
    const issueId = snapshot.issues.find((item) => item.title === 'Issue 证据总数').id
    const context = await request.get(`${baseURL}/project-orchestrator/api/issues/${issueId}/context`).then((response) => response.json())
    expect(context.totals).toMatchObject({ taskRuns: 101, transcripts: 101, artifacts: 303 })
  } finally {
    await host.cleanup()
  }
})
