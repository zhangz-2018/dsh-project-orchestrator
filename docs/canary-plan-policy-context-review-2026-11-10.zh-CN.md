# greeting 同构建隔离验收计划

状态：技术规划通过，尚未登记人工批准、派发或交付。本材料供批准具体新计划，不构成已执行证明。

## 精确对象

| 对象 | 值 |
| --- | --- |
| 隔离 Host | `http://127.0.0.1:3088`，非日常 3080 |
| 项目 | `ac9fafa7-c07b-4802-a177-6f4c986130bc`，revision `3` |
| 当前规划操作 | `planning-v3:9e9cd022-375f-4766-82cb-8243a7be5923` |
| 计划摘要 | `21aed08d2675877201267d16b55e25a160c29fb93d20541dd2674740bd157b05` |
| 插件 bundle SHA-256 | `600d0defdba7c040748ce1f258c367a95c503f1f2c68ba82ee6dab246dfe0947` |
| 本次重建夹具基线 | `77aa9a174da47c111f190d8cc52dfb91c8b00635` |
| 工作区 | `output/acceptance/formal-170-20261109/canary-measurement-workspace` |

## 任务与验收

1. `TASK-IMPLEMENT` 由 Software Engineer 承担，仅修改 `src/greeting.ts`。首次写入前记录当前真实基线及 `npm run test` 结果；姓名先 `trim()`，为空同步抛 `TypeError`，其余返回既有 `Hello, ${name}!` 格式，保留 `greet(name: string): string` 和导出名。完成后再次执行原测试，交付本次基线、变更和真实结果。
2. `TASK-VERIFY` 由不同的 Test Engineer 承担，依赖前项。仅在 `tests/greeting.test.ts` 增加独立测试：`greet(' Ada ')` 返回 `Hello, Ada!`；空字符串、纯空白各自同步抛 `TypeError`；保留 `greet('Ada')` 回归。运行 `npm run test`，四项测试全部通过，并只读核对签名、依赖和精确修改范围。

需求、场景、代码绑定和计划四项独立审核均为 approved；两项分配 selected，两项执行预检 accepted，规划和执行准备均 ready。原 9 条已确认能力继续适用，没有扩展成员、能力或写入范围。原请求因政策快照变化自动生成本后继，完整保留根请求，不将后继计为评测独立根。

## 批准边界

本次批准将允许通过正式接口登记此 revision 与摘要的人工计划批准，并依次派发上述两个隔离任务。不修改依赖、package manifest、README 或其他仓库文件，不修改上游，不自动登记最终 diff 的人工审阅，不发布 GitHub Release 或 npm。

此前批准的最终 commit `d5bbf64bad16a3c98cb21290395fdfaba3c4cc6d` 已完成登记、交付和导出，但属于另一个跨构建验收环境，不能代签本计划。最终交付完成后另行提供精确 commit 和独立验收材料。正式发布仍须当前构建的全样本规划及交付门禁全部通过。

只读计划证据：`output/acceptance/formal-170-20261109/canary-measurement/plan-policy-context-review.json`；完整本次规划账本：同目录 `planning-policy-context.json`。
