# 从本地构建或带作用域构建迁移

[English](migration.md) | 简体中文

公开软件包将替代 `@mindquant/dsh-project-orchestrator` 等开发构建，同时有意保留：

- Cordis 插件名称 `project-orchestrator`；
- HTTP 前缀 `/project-orchestrator/api`；
- 存储域 `project_orchestrator`；
- 现有的版本 1 记录 schema 和兼容性投影。

这样可确保加载器软件包名称发生变化时，本地数据仍得到保留。

## 安全迁移

1. 停止现有的 Harness Host。
2. 备份 `~/.dsh/storages/project_orchestrator.json`。
3. 通过同一个 Web profile 安装 `dsh-project-orchestrator@1.3.1`。
4. 替换加载器行中的软件包名称；不要添加第二行：

   ```yaml
   - id: project-orchestrator
     name: dsh-project-orchestrator
   ```

5. 仅在新软件包安装完成后，移除旧的带作用域软件包。
6. 重启现有 Host 一次。
7. 验证健康状态、快照数量、已排队或已恢复的 TaskRun，以及 Web 启动入口。

切勿同时加载这两个软件包。它们会注册相同的 Host route 和存储域，从而产生所有者冲突。

## Client 模块标识

公开 Client 模块的加载器 ID 为 `dsh-project-orchestrator`；旧的 Client 缓存产物中可能仍包含带作用域的 ID。迁移后重启 Host 并刷新 Web 页面，以便 shell 获取当前 bundle。

## 回滚

停止 Host；如有需要，恢复之前的加载器软件包和存储备份，然后重新启动。未来一旦发生 schema 迁移，除非相应版本明确说明支持降级兼容，否则不要降级。
