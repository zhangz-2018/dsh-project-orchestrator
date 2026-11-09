import { expect, test } from '@playwright/test'
import { createHostFixture } from '../support/host-fixture.mjs'

test('native panels render missing services and keep failed PR binding visible on desktop and mobile', async ({ page }) => {
  const host = await createHostFixture()
  try {
    const baseURL = await host.start()
    await page.goto(baseURL)
    await page.getByRole('button', { name: '打开交付工作台' }).click()
    await page.getByRole('button', { name: '更多', exact: true }).click()
    await page.getByRole('button', { name: /运行环境/ }).first().click()
    const diagnostics = page.getByRole('region', { name: 'Host 原生能力' })
    await expect(diagnostics).toContainText('服务未加载')
    await expect(diagnostics).toContainText('Node / CLI')
    await page.getByRole('button', { name: /^项目/ }).click()
    await page.getByRole('button', { name: '新建项目' }).click()
    await page.getByLabel('项目名称').fill('Native integration preview')
    await page.getByRole('button', { name: '选择目录' }).click()
    await page.getByRole('button', { name: '创建空项目' }).click()
    const pr = page.getByRole('region', { name: 'Pull Request 关联' })
    await expect(pr).toContainText('未关联')
    await pr.getByRole('button', { name: '关联 PR' }).click()
    await pr.getByLabel('PR URL').fill('https://github.com/sample/repo/pull/1')
    await pr.getByLabel('确认本地 HEAD').fill('a'.repeat(40))
    await pr.getByRole('button', { name: '保存本地关联' }).click()
    await expect(pr.getByRole('alert')).toContainText('unavailable')
    await expect(pr.getByLabel('PR URL')).toHaveValue('https://github.com/sample/repo/pull/1')
    for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport)
      await pr.scrollIntoViewIfNeeded()
      expect(await pr.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      await page.screenshot({ path: `output/playwright/native-pr-${viewport.width}.png`, fullPage: true })
    }
  } finally { await host.cleanup() }
})
