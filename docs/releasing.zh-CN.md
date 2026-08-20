# 发布操作手册

[English](releasing.md) | 简体中文

只有维护者可以发布版本。

## 一次性仓库设置

1. 创建 `zhangz-2018/dsh-project-orchestrator`，并将 `main` 设为默认分支。
2. 启用 Discussions、私密漏洞报告、Dependabot 警报、密钥扫描和推送保护。
3. 保护 `main`：要求通过 pull request 合并、解决所有对话，并通过 CI 和 CodeQL 检查；禁止强制推送和删除。
4. 添加一个 ruleset，限制创建 `v*` tag。
5. 创建一个名为 `npm` 的受保护 GitHub environment。
6. 在 npm 中，为所有者 `zhangz-2018`、仓库 `dsh-project-orchestrator`、workflow `release.yml` 和 environment `npm` 配置可信发布。
7. 保持默认 GitHub Actions token 权限为只读。

## 发布检查清单

1. 确认 `docs/compatibility.md` 与已测试的 Harness 版本一致。
2. 更新 `CHANGELOG.md` 和 `package.json` 中的版本。
3. 运行：

   ```bash
   corepack enable
   pnpm install --frozen-lockfile
   pnpm verify
   npm publish --dry-run --access public
   ```

4. 确认该软件包名称仍可注册，或已归维护者所有。
5. 通过受保护的 `main` 完成合并。
6. 创建并推送与 manifest 完全匹配的附注 tag：

   ```bash
   git tag -a "v${VERSION}" -m "dsh-project-orchestrator v${VERSION}"
   git push origin "v${VERSION}"
   ```

7. 发布 workflow 会重新运行验证、使用 npm provenance 发布，并创建 GitHub release notes。
8. 验证 npm provenance 链接；通过一个干净的 Harness profile 安装；重启现有 Host；并确认 `/project-orchestrator/api/health` 和 Web 启动入口均正常。

## 发布失败

不要移动或重复使用已经发布的 npm 版本。应使用新的 patch 版本向前修复。如果 npm 发布成功但 GitHub release 创建失败，请针对不可变的 tag 手动创建 release notes。如果尚未发生发布，则仅可依据仓库的 tag 保护策略，并在确认没有使用者收到该 tag 后，删除或替换该 tag。
