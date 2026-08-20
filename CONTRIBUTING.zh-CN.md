# 贡献指南

[English](CONTRIBUTING.md) | 简体中文

感谢你帮助改进 `dsh-project-orchestrator`。

## 提交变更前

- 搜索现有的 Issues 和 Discussions。
- 对于行为变更，请说明业务负责人、事实来源（source of truth）、写入/读取路径、失败语义、兼容性影响和验证计划。
- 在实现前讨论会造成破坏性影响的 API、存储、安全或执行变更。
- 切勿包含凭据、真实的 Harness 存储数据、私有仓库数据、本地 profile 配置或生成的 `lib/` 构件。

## 开发环境设置

要求：Node.js 22+、pnpm 10.34.5、Git，以及用于实时验证的受支持 DeepSeek Harness 环境。

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

测试套件使用 Node 的测试运行器，并使用真实的临时 Git 仓库覆盖 worktree 场景。测试不得依赖贡献者的绝对路径。

## Pull Request

1. 保持变更聚焦，并更新测试。
2. 在适用时覆盖成功、拒绝/失败、边界以及行为保持不变的场景。
3. 当契约发生变化时，更新 README、API、兼容性和运维文档。
4. 对用户可见的变更添加 changelog 条目。
5. 运行 `pnpm verify` 并附上结果。
6. 说明存储迁移和回滚影响。
7. 确认未提交生成的 bundle、tarball、`.env`、存储数据或本地 worktree。

提交信息应清晰并使用祈使语气。鼓励但不强制使用 Conventional Commit 前缀。

## 发布政策

只有维护者可以发布。发布 tag 必须与 package 版本完全一致，CI 和 package smoke 必须通过，npm 发布使用带 provenance 的 trusted publishing。参见 `GOVERNANCE.zh-CN.md` 和 `docs/compatibility.zh-CN.md`。
