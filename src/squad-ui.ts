import type { AgentRecord, EscalationTrigger, SquadEscalationPolicy, SquadRecord } from './client-types.js'

export const RECOMMENDED_LEADER_INSTRUCTIONS = `## 委派条件
仅委派边界独立、输入明确、可以单独审核的工作。简单且低风险的工作由 Leader 直接完成。

## 子任务要求
每个子任务写明目标、范围、禁止修改范围、交付物、验收标准、验证证据和升级条件。

## 成员选择
按 Squad 内职责、工具权限和当前占用选择成员。避免多个成员同时修改同一核心模块。

## 汇总要求
Leader 必须检查成员结果、审核意见和证据，处理冲突与遗漏，完成必要的集成验证后再提交父 Issue 审核。`

export const DEFAULT_COLLABORATION_POLICY_VERSION = 'squad-collaboration.v1'

export const ESCALATION_TRIGGER_OPTIONS: ReadonlyArray<{ value: EscalationTrigger; label: string; description: string }> = [
  { value: 'requirement_conflict', label: '需求事实冲突', description: 'PRD、技术方案或实现出现实质冲突' },
  { value: 'contract_conflict', label: '外部契约冲突', description: '接口、数据或兼容契约无法同时满足' },
  { value: 'destructive_change', label: '破坏性变更', description: '迁移、删除或其他不可逆操作' },
  { value: 'production_data_change', label: '生产数据变更', description: '需要修改真实生产数据' },
  { value: 'permission_required', label: '需要扩大权限', description: '当前工具权限不足' },
  { value: 'credential_required', label: '需要凭证', description: '工作依赖未提供的密钥或凭证' },
  { value: 'verification_unavailable', label: '无法验证', description: '无法确认验证命令或验收方式' },
  { value: 'repeated_failure', label: '同类验证重复失败', description: '针对性修复达到预算后仍失败' },
  { value: 'scope_expansion', label: '范围明显扩大', description: '工作超出父 Issue 已批准边界' },
  { value: 'delegation_conflict', label: '委派结果冲突', description: '成员结果无法依据证据裁决' },
  { value: 'source_of_truth_unknown', label: '来源事实不明', description: '无法确认权威数据或实现来源' },
]

export const DEFAULT_SQUAD_ESCALATION_POLICY: SquadEscalationPolicy = {
  triggers: ['requirement_conflict', 'destructive_change', 'production_data_change', 'permission_required', 'verification_unavailable', 'repeated_failure', 'delegation_conflict'],
  maxFocusedRepairAttempts: 1,
  onTrigger: 'request_decision',
  pauseParentIssue: true,
  cancelSiblingDelegations: false,
  customInstructions: '',
}

export interface SquadUiDiagnostic {
  code: string
  message: string
  scope: '协作协议' | '成员职责' | '升级策略' | '并行容量'
}

export function effectiveSquadEscalationPolicy(squad?: Pick<SquadRecord, 'escalationConfig' | 'escalationPolicy'>): SquadEscalationPolicy {
  if (squad?.escalationConfig) return copyEscalationPolicy(squad.escalationConfig)
  return { ...copyEscalationPolicy(DEFAULT_SQUAD_ESCALATION_POLICY), customInstructions: squad?.escalationPolicy ?? '' }
}

export function copyEscalationPolicy(policy: SquadEscalationPolicy): SquadEscalationPolicy {
  return { ...policy, triggers: [...policy.triggers] }
}

export function escalationTriggerSummary(policy: SquadEscalationPolicy): string {
  const labels = policy.triggers.map((trigger) => ESCALATION_TRIGGER_OPTIONS.find((item) => item.value === trigger)?.label ?? trigger)
  return `${labels.join('、')}；同类验证允许 ${policy.maxFocusedRepairAttempts} 次针对性修复后升级`
}

export function legacyEscalationPolicySummary(policy: SquadEscalationPolicy): string {
  const custom = policy.customInstructions.trim()
  return `系统触发：${escalationTriggerSummary(policy)}。触发后请求人工 Decision 并暂停父 Issue；保留其他成员工作。${custom ? `\n自定义说明：${custom}` : ''}`
}

export function squadUiDiagnostics(input: {
  instructions: string
  customInstructions: string
  memberAgentIds: string[]
  memberRoles: Record<string, string>
  leaderAgentId: string
  maxParallelDelegations: number
  agents: AgentRecord[]
}): SquadUiDiagnostic[] {
  const diagnostics: SquadUiDiagnostic[] = []
  const instructions = input.instructions.trim()
  if (instructions.length < 40) diagnostics.push({ code: 'instructions_short', scope: '协作协议', message: 'Leader 协作协议少于 40 字，可能无法明确委派边界和汇总要求。' })
  if (/^\d+$/.test(instructions)) diagnostics.push({ code: 'instructions_placeholder', scope: '协作协议', message: 'Leader 协作协议看起来仍是占位内容。' })
  if (input.memberAgentIds.length >= 5 && input.maxParallelDelegations === 1) diagnostics.push({ code: 'capacity_low', scope: '并行容量', message: '成员达到 5 名但并行上限为 1，委派可能长期排队。' })

  const memberEntries = input.memberAgentIds.map((agentId) => ({
    agentId,
    agent: input.agents.find((agent) => agent.id === agentId),
    role: (input.memberRoles[agentId] ?? '').trim(),
  }))
  const implementationPattern = /(实现|编码|开发|修改代码|软件工程师|工程执行|程序员|write|implement(?:ation|er|ing|ed)?|coding|software\s+(?:engineer|developer)|(?:front[ -]?end|back[ -]?end|full[ -]?stack)\s+(?:engineer|developer)|programmer)/i
  const verificationPattern = /(测试|验证|审查|回归|test|verify|review|qa)/i
  if (!memberEntries.some(({ agent, role }) => agent?.toolPolicy === 'full' && implementationPattern.test(`${role} ${agent.role}`))) diagnostics.push({ code: 'implementation_member_missing', scope: '成员职责', message: '需要至少一名“可执行”成员，且职责明确包含代码实现或软件开发（例如 Software Engineer、开发、实现）。' })
  if (!memberEntries.some(({ role, agent }) => verificationPattern.test(`${role} ${agent?.role ?? ''}`))) diagnostics.push({ code: 'verification_member_missing', scope: '成员职责', message: '没有识别到明确负责验证或审查的成员。' })
  for (const { agent, role } of memberEntries) {
    if (agent?.toolPolicy === 'read_only' && implementationPattern.test(role)) diagnostics.push({ code: `read_only_implementation:${agent.id}`, scope: '成员职责', message: `${agent.name} 是只读 Agent，但职责包含实现或修改代码。` })
  }
  for (let left = 0; left < memberEntries.length; left += 1) {
    for (let right = left + 1; right < memberEntries.length; right += 1) {
      const a = memberEntries[left]!
      const b = memberEntries[right]!
      if (rolesOverlap(a.role, b.role)) diagnostics.push({ code: `role_overlap:${a.agentId}:${b.agentId}`, scope: '成员职责', message: `${a.agent?.name ?? a.agentId} 与 ${b.agent?.name ?? b.agentId} 的职责高度重复。` })
    }
  }
  const leader = memberEntries.find((entry) => entry.agentId === input.leaderAgentId)
  if (leader) {
    const planningPattern = /(规划|拆解|架构|分析|plan|architect|analysis)/i
    const overlappingPlanner = memberEntries.find((entry) => entry.agentId !== leader.agentId && planningPattern.test(entry.role) && rolesOverlap(leader.role, entry.role))
    if (overlappingPlanner) diagnostics.push({ code: 'leader_role_overlap', scope: '成员职责', message: `Leader 与 ${overlappingPlanner.agent?.name ?? overlappingPlanner.agentId} 的规划职责重叠，建议明确协调和交付责任。` })
  }
  const custom = input.customInstructions.trim()
  if (/(不要|无需|禁止).{0,8}(升级|decision|人工)|(继续执行|自动继续).{0,8}(高风险|冲突|失败)/i.test(custom)) diagnostics.push({ code: 'custom_policy_conflict', scope: '升级策略', message: '自定义升级说明可能与系统触发器的暂停和人工 Decision 动作冲突；系统规则仍优先。' })
  return diagnostics
}

function rolesOverlap(left: string, right: string): boolean {
  const a = roleTokens(left)
  const b = roleTokens(right)
  if (a.length === 0 || b.length === 0) return false
  const shared = a.filter((token) => b.includes(token)).length
  return shared / Math.min(a.length, b.length) >= 0.75
}

function roleTokens(value: string): string[] {
  return [...new Set(value.toLocaleLowerCase().split(/[\s,，、。；;:/]+/).map((token) => token.trim()).filter((token) => token.length >= 2))]
}
