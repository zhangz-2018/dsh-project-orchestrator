import { z } from 'zod'

/** 独立版本的只读 PR 关联；不写入 Project revision 或审批摘要。 */
export const PullRequestBindingSchema = z.object({
  /** 当前一项目一关联，key 使用 projectId。 */
  projectId: z.string().min(1),
  /** 本记录格式版本；旧安装没有此表时读取为空。 */
  schemaVersion: z.literal(1),
  /** 经 Forge provider 规范化的 HTTPS 地址。 */
  url: z.string().url().max(4096),
  /** provider 家族与远端仓库身份，来自实际 Git remote。 */
  repository: z.object({ forge: z.string().min(1), host: z.string().min(1), owner: z.string().min(1), name: z.string().min(1) }).strict(),
  /** provider 分配的 PR/MR 编号。 */
  number: z.number().int().positive(),
  /** 绑定时操作者确认的本地 HEAD；仅用于外部证据一致性提示。 */
  expectedHead: z.string().regex(/^[0-9a-f]{40,64}$/u),
  /** 首次绑定时间；换绑时保留。 */
  boundAt: z.string().datetime(),
  /** 单调递增的最后修改时间，用于本地 CAS。 */
  updatedAt: z.string().datetime(),
}).strict()
export type PullRequestBinding = z.infer<typeof PullRequestBindingSchema>

export interface NativeCapability {
  /** 实际 Host 服务名，不使用安装包是否存在推测。 */
  id: string
  /** 工作台中的能力名称。 */
  label: string
  /** present 只表示服务存在；未探测凭据/执行策略时不能宣称 ready。 */
  state: 'present' | 'missing'
  /** 当前集成范围或尚缺的运行条件。 */
  detail: string
}

export interface NativeDiagnostics {
  /** 本次读取时间，诊断不保存也不包含凭据。 */
  observedAt: string
  /** 命令实际选用的后端；CLI 保留 node，Host 必须使用 dsh_subprocess。 */
  commandBackend: 'node' | 'dsh_subprocess'
  /** 独立能力清单，缺失可选服务不阻断核心插件加载。 */
  capabilities: NativeCapability[]
}
