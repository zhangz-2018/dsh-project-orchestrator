# 发布评测能力补充确认：52 项、14 个隔离项目

日期：2026-10-16。状态：全部为待确认声明，未登记 human_confirmed。原 204 条已登记，保持不变。本清单只用于规划评测，不批准计划、不派发任务、不发布。

本清单由[原 48 项补充](release-capability-addendum-complete-2026-10-16.zh-CN.md)和下列 Zod 4 项组成，共 52 项；不是在 48 项之外另加 52 项。原 48 项未获确认，不能使用原 204 项授权登记。原 48 项机器清单及其摘要未改动。

## Zod 新增 4 项的依据

v12 独立 Gold 审阅退回 trim 样本，指出缺少 data.change，与更早预检的“无缺口”结论冲突。因此重新提供两项原始 PRD、实际 `_stringbool` 的完整构造/parse/encode 函数、现行能力规则和项目可信声明，单独审阅两项的能力边界，没有提供候选或先前审阅意见。

审阅结果：trim 扩展 codec 配置契约；overlap 的固定 OPT-1 建立归一化词表构造时的不相交约束。它们均涉及现行规则包含的 data-model contract，不能仅视为一次调用中的无状态值转换。规则将必要 shared_data 影响映射到 data.change。保留数组或 Set 本身不等于可变状态，因此未据此追加 domain.state。实现和独立验证两角色均拥有原规范限定的源码/测试范围。

这是基于源码的声明准备依据，不是实际规划派生的最小能力集合，也不证明成员已经具备能力。实际计划仍须独立审阅和 Service 校验，不会为获得通过而取消影响面、修改需求或把 ready 预期改成 blocked。

审阅证据：仅原验收机器保留的专项结论 `output/acceptance/zod-capability-boundary-v13-2026-10-16/review.json`（路径从仓库根目录计算，不随源码或 npm 包分发）。只产生诊断，没有规划候选或人工确认。

## 精确新增范围

| 原始样本 | projectId | agentId | 角色 | capabilityId |
| --- | --- | --- | --- | --- |
| zod-stringbool-trim | `fe2e485b-b8f3-4d8e-8991-499ad5fb7bc5` | `da6f43df-b9a4-499b-ae1a-d39ae3f51711` | implementer | `data.change` |
| zod-stringbool-trim | `fe2e485b-b8f3-4d8e-8991-499ad5fb7bc5` | `2ef2743b-5017-4ab1-9853-329cc8c1ca8e` | verifier | `data.change` |
| zod-stringbool-overlap-resolved | `f45acad5-36c5-422b-8288-b2996dd4a754` | `da6f43df-b9a4-499b-ae1a-d39ae3f51711` | implementer | `data.change` |
| zod-stringbool-overlap-resolved | `f45acad5-36c5-422b-8288-b2996dd4a754` | `2ef2743b-5017-4ab1-9853-329cc8c1ca8e` | verifier | `data.change` |

两名成员仍是原 Release evaluation implementer / verifier 2026-10-16。只限原有两个 Zod 隔离项目，精确文件范围仍为 core/api.ts 与 classic/mini 的 stringbool 测试；不扩展写入范围，不修改上游仓库。

## 合并清单与登记方式

仅原验收机器保留的 52 项机器清单 `output/acceptance/release-capability-addendum-52-2026-10-16.json` 包含每项 projectId、agentId、capabilityId、pending claimId、expectedClaimDigest 和理由，不随源码或 npm 包分发。SHA256：`ec3e3f5a4e7302a426c129a60be3a27f64967f62401fadf3912fa0605c5052b4`。

原 12 个项目的 48 项保持原 pending 记录；另通过正式 prepare 接口准备了两个 Zod 项目的 4 项 pending。人工可信声明未增加。只有用户明确确认这份 52 项合并清单并允许登记，才可通过正式 confirm 接口写入 human_confirmed。接口会校验精确 claimId 和 expectedClaimDigest。

能力登记后仍须冻结各项目的新团队事实、独立审阅 Gold、完成同一 bundle 的真实规划重复与最终 release gate；本清单的批准不能代替验收通过。
