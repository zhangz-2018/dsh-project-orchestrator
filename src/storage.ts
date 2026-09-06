import { z } from 'zod'
import {
  defineDomain,
  domainTable,
  type Domain,
} from '@deepseek-ai/dsh-storage-domain'
import {
  ActivityEventSchema,
  DomainEventRecordSchema,
  CommentRecordSchema,
  DecisionRecordSchema,
  SquadRecordSchema,
  DelegationRecordSchema,
  TranscriptEntrySchema,
  ArtifactRecordSchema,
  CommandRecordSchema,
  ExternalTriggerRecordSchema,
  SkillRecordSchema,
  LocalDirectoryLockRecordSchema,
  WorkspaceLeaseRecordSchema,
  WorkspaceWriterLeaseRecordSchema,
  TaskRunConflictLockRecordSchema,
  AgentRecordSchema,
  ApprovalRecordSchema,
  IssueRecordSchema,
  ProjectRecordSchema,
  ProjectResourceSchema,
  RunRecordSchema,
  RuntimeRecordSchema,
  TaskRecordSchema,
  TaskRunRecordSchema,
  ProjectAgentMembershipRecordSchema,
  ProjectSquadBindingRecordSchema,
  ProjectAgentMembershipSourceRecordSchema,
  PlanSnapshotRecordSchema,
  RequirementBundleRecordSchema,
  RequirementItemRecordSchema,
  RequirementDecisionRecordSchema,
  AcceptanceCriterionRecordStorageSchema,
  VerificationEvidenceRecordSchema,
  ProjectReviewRecordSchema,
  DeliveryRecordSchema,
  FeatureUsageDailyRecordSchema,
  PlanningOperationRecordSchema,
  PlanningMetricPolicyRecordSchema,
  PlanningMetricPolicyPublishRecordSchema,
  PlanningShadowEvaluationRecordSchema,
  PlanningStageAttemptRecordSchema,
  PlanningCheckpointRecordSchema,
  StorageMutationIntentRecordSchema,
  PlanningSourceInputRecordSchema,
  RequirementSourceProfileRecordSchema,
  RequirementSourceManifestRecordStorageSchema,
  RequirementAnalysisProposalRecordStorageSchema,
  PlanningRepairAttemptRecordSchema,
  SourceDispositionBindingRecordSchema,
  AcceptanceScenarioRecordSchema,
  AcceptanceScenarioCoveragePolicyRecordSchema,
  PlanningRiskProfileRecordSchema,
  SourcePolicyPrecheckRecordSchema,
  RequirementDecisionOptionEffectRecordSchema,
  RequirementDecisionPlanningEffectRecordSchema,
  ScenarioCoverageReviewRecordSchema,
  PlanningReviewRecordV3Schema,
  RepositoryContextSnapshotV3RecordSchema,
  RepositoryStackProfileRecordSchema,
  RepositoryEvidenceRetrievalReportSchema,
  CanonicalTargetBindingRecordSchema,
  RepositoryPolicyBaselineRecordSchema,
  PolicyConstraintRecordV3Schema,
  PlanningPolicySnapshotRecordSchema,
  PlanningPromptReferenceManifestRecordSchema,
  RequirementCodeBindingRecordSchema,
  PlanningProposalPackRecordSchema,
  PlanningReferenceMapRecordSchema,
  PolicyFulfillmentRecordSchema,
  CapabilityDefinitionRecordSchema,
  AgentCapabilityClaimRecordSchema,
  ProjectCapabilityCatalogSnapshotRecordSchema,
  ResourceAccessGrantRecordSchema,
  ProjectAccessGrantSnapshotRecordSchema,
  CapabilityRequirementDraftRecordSchema,
  AssignmentDraftRecordSchema,
  AssignmentEvaluationRecordSchema,
  ExpectedAssignmentFixtureRecordSchema,
  PlanningMetricReleaseReportCreateRecordSchema,
  PlanningMetricReleaseReportRecordSchema,
  TaskPreflightRecordV3Schema,
  PlanApprovalV3RecordSchema,
  ExecutionDispatchRecordSchema,
  DeliveryIntegrationSnapshotRecordSchema,
  IntegrationInclusionEvidenceRecordSchema,
  DeliveryConvergenceFindingRecordSchema,
  DeliveryConvergenceReviewRecordSchema,
  ConvergenceRepairBaselineRecordSchema,
  ConvergenceRepairCarryItemRecordSchema,
  ConvergenceCarryValidationRecordSchema,
  type ActivityEvent,
  type DomainEventRecord,
  type DomainEventPage,
  type CommentRecord,
  type DecisionRecord,
  type SquadRecord,
  type DelegationRecord,
  type TranscriptEntry,
  type ArtifactRecord,
  type CommandRecord,
  type ExternalTriggerRecord,
  type SkillRecord,
  type LocalDirectoryLockRecord,
  type WorkspaceLeaseRecord,
  type WorkspaceWriterLeaseRecord,
  type TaskRunConflictLockRecord,
  type AgentRecord,
  type ApprovalRecord,
  type IssueRecord,
  type ProjectRecord,
  type ProjectResource,
  type RunRecord,
  type RuntimeRecord,
  type Snapshot,
  type TaskRecord,
  type TaskRunRecord,
  type ProjectAgentMembershipRecord,
  type ProjectSquadBindingRecord,
  type ProjectAgentMembershipSourceRecord,
  type FeatureUsageDailyRecord,
  type PlanSnapshotRecord,
  type RequirementBundleRecord,
  type RequirementItemRecord,
  type RequirementDecisionRecord,
  type AcceptanceCriterionRecord,
  type VerificationEvidenceRecord,
  type ProjectReviewRecord,
  type DeliveryRecord,
  type PlanningOperationRecord,
  type PlanningMetricPolicyRecord,
  type PlanningMetricPolicyPublishRecord,
  type PlanningShadowEvaluationRecord,
  type PlanningStageAttemptRecord,
  type PlanningCheckpointRecord,
  type StorageMutationIntentRecord,
  type PlanningSourceInputRecord,
  type RequirementSourceProfileRecord,
  type RequirementSourceManifestRecord,
  type RequirementAnalysisProposalRecord,
  type PlanningRepairAttemptRecord,
  type SourceDispositionBindingRecord,
  type AcceptanceScenarioRecord,
  type AcceptanceScenarioCoveragePolicyRecord,
  type PlanningRiskProfileRecord,
  type SourcePolicyPrecheckRecord,
  type RequirementDecisionOptionEffectRecord,
  type RequirementDecisionPlanningEffectRecord,
  type ScenarioCoverageReviewRecord,
  type PlanningReviewRecordV3,
  type RepositoryContextSnapshotV3Record,
  type RepositoryStackProfileRecord,
  type RepositoryEvidenceRetrievalReport,
  type CanonicalTargetBindingRecord,
  type RepositoryPolicyBaselineRecord,
  type PolicyConstraintRecordV3,
  type PlanningPolicySnapshotRecord,
  type PlanningPromptReferenceManifestRecord,
  type RequirementCodeBindingRecord,
  type PlanningProposalPackRecord,
  type PlanningReferenceMapRecord,
  type PolicyFulfillmentRecord,
  type CapabilityDefinitionRecord,
  type AgentCapabilityClaimRecord,
  type ProjectCapabilityCatalogSnapshotRecord,
  type ResourceAccessGrantRecord,
  type ProjectAccessGrantSnapshotRecord,
  type CapabilityRequirementDraftRecord,
  type AssignmentDraftRecord,
  type AssignmentEvaluationRecord,
  type ExpectedAssignmentFixtureRecord,
  type PlanningMetricReleaseReportCreateRecord,
  type PlanningMetricReleaseReportRecord,
  type TaskPreflightRecordV3,
  type PlanApprovalV3Record,
  type ExecutionDispatchRecord,
  type DeliveryIntegrationSnapshotRecord,
  type IntegrationInclusionEvidenceRecord,
  type DeliveryConvergenceFindingRecord,
  type DeliveryConvergenceReviewRecord,
  type ConvergenceRepairBaselineRecord,
  type ConvergenceRepairCarryItemRecord,
  type ConvergenceCarryValidationRecord,
} from './types.js'
import { STORAGE_CAPABILITIES, type StorageCapabilities } from './storage-unit-of-work.js'
import { WorkflowError, planDigest } from './workflow.js'

export const orchestratorDomain = defineDomain({
  name: 'project_orchestrator',
  version: 1,
  global: {
    schema: z.object({ schemaVersion: z.literal(1) }),
    initial: { schemaVersion: 1 },
  },
  tables: {
    agents: domainTable<string, AgentRecord>(AgentRecordSchema),
    projects: domainTable<string, ProjectRecord>(ProjectRecordSchema),
    tasks: domainTable<string, TaskRecord>(TaskRecordSchema),
    approvals: domainTable<string, ApprovalRecord>(ApprovalRecordSchema),
    runs: domainTable<string, RunRecord>(RunRecordSchema),
    runtimes: domainTable<string, RuntimeRecord>(RuntimeRecordSchema),
    resources: domainTable<string, ProjectResource>(ProjectResourceSchema),
    issues: domainTable<string, IssueRecord>(IssueRecordSchema),
    task_runs: domainTable<string, TaskRunRecord>(TaskRunRecordSchema),
    activity: domainTable<string, ActivityEvent>(ActivityEventSchema),
    domain_events: domainTable<string, DomainEventRecord>(DomainEventRecordSchema),
    comments: domainTable<string, CommentRecord>(CommentRecordSchema),
    decisions: domainTable<string, DecisionRecord>(DecisionRecordSchema),
    squads: domainTable<string, SquadRecord>(SquadRecordSchema),
    delegations: domainTable<string, DelegationRecord>(DelegationRecordSchema),
    transcripts: domainTable<string, TranscriptEntry>(TranscriptEntrySchema),
    artifacts: domainTable<string, ArtifactRecord>(ArtifactRecordSchema),
    commands: domainTable<string, CommandRecord>(CommandRecordSchema),
    external_triggers: domainTable<string, ExternalTriggerRecord>(ExternalTriggerRecordSchema),
    skills: domainTable<string, SkillRecord>(SkillRecordSchema),
    local_directory_locks: domainTable<string, LocalDirectoryLockRecord>(LocalDirectoryLockRecordSchema),
    workspace_leases: domainTable<string, WorkspaceLeaseRecord>(WorkspaceLeaseRecordSchema),
    workspace_writer_leases: domainTable<string, WorkspaceWriterLeaseRecord>(WorkspaceWriterLeaseRecordSchema),
    task_run_conflict_locks: domainTable<string, TaskRunConflictLockRecord>(TaskRunConflictLockRecordSchema),
    project_agent_memberships: domainTable<string, ProjectAgentMembershipRecord>(ProjectAgentMembershipRecordSchema),
    project_squad_bindings: domainTable<string, ProjectSquadBindingRecord>(ProjectSquadBindingRecordSchema),
    project_agent_membership_sources: domainTable<string, ProjectAgentMembershipSourceRecord>(ProjectAgentMembershipSourceRecordSchema),
    feature_usage_daily: domainTable<string, FeatureUsageDailyRecord>(FeatureUsageDailyRecordSchema),
    plan_snapshots: domainTable<string, PlanSnapshotRecord>(PlanSnapshotRecordSchema),
    requirement_bundles: domainTable<string, RequirementBundleRecord>(RequirementBundleRecordSchema),
    requirement_items: domainTable<string, RequirementItemRecord>(RequirementItemRecordSchema),
    requirement_decisions: domainTable<string, RequirementDecisionRecord>(RequirementDecisionRecordSchema),
    acceptance_criteria: domainTable<string, AcceptanceCriterionRecord>(AcceptanceCriterionRecordStorageSchema),
    verification_evidence: domainTable<string, VerificationEvidenceRecord>(VerificationEvidenceRecordSchema),
    project_reviews: domainTable<string, ProjectReviewRecord>(ProjectReviewRecordSchema),
    delivery_records: domainTable<string, DeliveryRecord>(DeliveryRecordSchema),
    planning_operations: domainTable<string, PlanningOperationRecord>(PlanningOperationRecordSchema),
    planning_metric_policies: domainTable<string, PlanningMetricPolicyRecord>(PlanningMetricPolicyRecordSchema),
    planning_metric_policy_publishes: domainTable<string, PlanningMetricPolicyPublishRecord>(PlanningMetricPolicyPublishRecordSchema),
    planning_shadow_evaluations: domainTable<string, PlanningShadowEvaluationRecord>(PlanningShadowEvaluationRecordSchema),
    planning_stage_attempts: domainTable<string, PlanningStageAttemptRecord>(PlanningStageAttemptRecordSchema),
    planning_checkpoints: domainTable<string, PlanningCheckpointRecord>(PlanningCheckpointRecordSchema),
    storage_mutation_intents: domainTable<string, StorageMutationIntentRecord>(StorageMutationIntentRecordSchema),
    planning_source_inputs: domainTable<string, PlanningSourceInputRecord>(PlanningSourceInputRecordSchema),
    requirement_source_profiles: domainTable<string, RequirementSourceProfileRecord>(RequirementSourceProfileRecordSchema),
    requirement_source_manifests: domainTable<string, RequirementSourceManifestRecord>(RequirementSourceManifestRecordStorageSchema),
    requirement_analysis_proposals: domainTable<string, RequirementAnalysisProposalRecord>(RequirementAnalysisProposalRecordStorageSchema),
    planning_repair_attempts: domainTable<string, PlanningRepairAttemptRecord>(PlanningRepairAttemptRecordSchema),
    source_disposition_bindings: domainTable<string, SourceDispositionBindingRecord>(SourceDispositionBindingRecordSchema),
    acceptance_scenarios: domainTable<string, AcceptanceScenarioRecord>(AcceptanceScenarioRecordSchema),
    acceptance_scenario_coverage_policies: domainTable<string, AcceptanceScenarioCoveragePolicyRecord>(AcceptanceScenarioCoveragePolicyRecordSchema),
    planning_risk_profiles: domainTable<string, PlanningRiskProfileRecord>(PlanningRiskProfileRecordSchema),
    source_policy_prechecks: domainTable<string, SourcePolicyPrecheckRecord>(SourcePolicyPrecheckRecordSchema),
    requirement_decision_option_effects: domainTable<string, RequirementDecisionOptionEffectRecord>(RequirementDecisionOptionEffectRecordSchema),
    requirement_decision_planning_effects: domainTable<string, RequirementDecisionPlanningEffectRecord>(RequirementDecisionPlanningEffectRecordSchema),
    scenario_coverage_reviews: domainTable<string, ScenarioCoverageReviewRecord>(ScenarioCoverageReviewRecordSchema),
    planning_reviews_v3: domainTable<string, PlanningReviewRecordV3>(PlanningReviewRecordV3Schema),
    repository_snapshots_v3: domainTable<string, RepositoryContextSnapshotV3Record>(RepositoryContextSnapshotV3RecordSchema),
    repository_stack_profiles: domainTable<string, RepositoryStackProfileRecord>(RepositoryStackProfileRecordSchema),
    repository_evidence_retrieval_reports: domainTable<string, RepositoryEvidenceRetrievalReport>(RepositoryEvidenceRetrievalReportSchema),
    canonical_target_bindings: domainTable<string, CanonicalTargetBindingRecord>(CanonicalTargetBindingRecordSchema),
    repository_policy_baselines: domainTable<string, RepositoryPolicyBaselineRecord>(RepositoryPolicyBaselineRecordSchema),
    policy_constraints_v3: domainTable<string, PolicyConstraintRecordV3>(PolicyConstraintRecordV3Schema),
    planning_policy_snapshots: domainTable<string, PlanningPolicySnapshotRecord>(PlanningPolicySnapshotRecordSchema),
    planning_prompt_reference_manifests: domainTable<string, PlanningPromptReferenceManifestRecord>(PlanningPromptReferenceManifestRecordSchema),
    requirement_code_bindings: domainTable<string, RequirementCodeBindingRecord>(RequirementCodeBindingRecordSchema),
    planning_proposal_packs: domainTable<string, PlanningProposalPackRecord>(PlanningProposalPackRecordSchema),
    planning_reference_maps: domainTable<string, PlanningReferenceMapRecord>(PlanningReferenceMapRecordSchema),
    policy_fulfillments: domainTable<string, PolicyFulfillmentRecord>(PolicyFulfillmentRecordSchema),
    capability_definitions: domainTable<string, CapabilityDefinitionRecord>(CapabilityDefinitionRecordSchema),
    agent_capability_claims: domainTable<string, AgentCapabilityClaimRecord>(AgentCapabilityClaimRecordSchema),
    project_capability_catalog_snapshots: domainTable<string, ProjectCapabilityCatalogSnapshotRecord>(ProjectCapabilityCatalogSnapshotRecordSchema),
    resource_access_grants: domainTable<string, ResourceAccessGrantRecord>(ResourceAccessGrantRecordSchema),
    project_access_grant_snapshots: domainTable<string, ProjectAccessGrantSnapshotRecord>(ProjectAccessGrantSnapshotRecordSchema),
    capability_requirement_drafts: domainTable<string, CapabilityRequirementDraftRecord>(CapabilityRequirementDraftRecordSchema),
    assignment_drafts: domainTable<string, AssignmentDraftRecord>(AssignmentDraftRecordSchema),
    assignment_evaluations: domainTable<string, AssignmentEvaluationRecord>(AssignmentEvaluationRecordSchema),
    expected_assignment_fixtures: domainTable<string, ExpectedAssignmentFixtureRecord>(ExpectedAssignmentFixtureRecordSchema),
    planning_metric_release_report_creates: domainTable<string, PlanningMetricReleaseReportCreateRecord>(PlanningMetricReleaseReportCreateRecordSchema),
    planning_metric_release_reports: domainTable<string, PlanningMetricReleaseReportRecord>(PlanningMetricReleaseReportRecordSchema),
    delivery_integration_snapshots: domainTable<string, DeliveryIntegrationSnapshotRecord>(DeliveryIntegrationSnapshotRecordSchema),
    integration_inclusion_evidence: domainTable<string, IntegrationInclusionEvidenceRecord>(IntegrationInclusionEvidenceRecordSchema),
    delivery_convergence_findings: domainTable<string, DeliveryConvergenceFindingRecord>(DeliveryConvergenceFindingRecordSchema),
    delivery_convergence_reviews: domainTable<string, DeliveryConvergenceReviewRecord>(DeliveryConvergenceReviewRecordSchema),
    convergence_repair_baselines: domainTable<string, ConvergenceRepairBaselineRecord>(ConvergenceRepairBaselineRecordSchema),
    convergence_repair_carry_items: domainTable<string, ConvergenceRepairCarryItemRecord>(ConvergenceRepairCarryItemRecordSchema),
    convergence_carry_validations: domainTable<string, ConvergenceCarryValidationRecord>(ConvergenceCarryValidationRecordSchema),
    task_preflights_v3: domainTable<string, TaskPreflightRecordV3>(TaskPreflightRecordV3Schema),
    plan_approvals_v3: domainTable<string, PlanApprovalV3Record>(PlanApprovalV3RecordSchema),
    execution_dispatches: domainTable<string, ExecutionDispatchRecord>(ExecutionDispatchRecordSchema),
  },
})

export class OrchestratorStore {
  readonly agents
  readonly projects
  readonly tasks
  readonly approvals
  readonly runs
  readonly runtimes
  readonly resources
  readonly issues
  readonly taskRuns
  readonly activity
  readonly domainEvents
  readonly comments
  readonly decisions
  readonly squads
  readonly delegations
  readonly transcripts
  readonly artifacts
  readonly commands
  readonly externalTriggers
  readonly skills
  readonly localDirectoryLocks
  readonly workspaceLeases
  readonly workspaceWriterLeases
  readonly taskRunConflictLocks
  readonly projectAgentMemberships
  readonly projectSquadBindings
  readonly projectAgentMembershipSources
  readonly featureUsageDaily
  readonly planSnapshots
  readonly requirementBundles
  readonly requirementItems
  readonly requirementDecisions
  readonly acceptanceCriteria
  readonly verificationEvidence
  readonly projectReviews
  readonly deliveryRecords
  readonly planningOperations
  readonly planningMetricPolicies
  readonly planningMetricPolicyPublishes
  readonly planningShadowEvaluations
  readonly planningStageAttempts
  readonly planningCheckpoints
  readonly storageMutationIntents
  readonly planningSourceInputs
  readonly requirementSourceProfiles
  readonly requirementSourceManifests
  readonly requirementAnalysisProposals
  readonly planningRepairAttempts
  readonly sourceDispositionBindings
  readonly acceptanceScenarios
  readonly acceptanceScenarioCoveragePolicies
  readonly planningRiskProfiles
  readonly sourcePolicyPrechecks
  readonly requirementDecisionOptionEffects
  readonly requirementDecisionPlanningEffects
  readonly scenarioCoverageReviews
  readonly planningReviewsV3
  readonly repositorySnapshotsV3
  readonly repositoryStackProfiles
  readonly repositoryEvidenceRetrievalReports
  readonly canonicalTargetBindings
  readonly repositoryPolicyBaselines
  readonly policyConstraintsV3
  readonly planningPolicySnapshots
  readonly planningPromptReferenceManifests
  readonly requirementCodeBindings
  readonly planningProposalPacks
  readonly planningReferenceMaps
  readonly policyFulfillments
  readonly capabilityDefinitions
  readonly agentCapabilityClaims
  readonly projectCapabilityCatalogSnapshots
  readonly resourceAccessGrants
  readonly projectAccessGrantSnapshots
  readonly capabilityRequirementDrafts
  readonly assignmentDrafts
  readonly assignmentEvaluations
  readonly expectedAssignmentFixtures
  readonly planningMetricReleaseReportCreates
  readonly planningMetricReleaseReports
  readonly deliveryIntegrationSnapshots
  readonly integrationInclusionEvidence
  readonly deliveryConvergenceFindings
  readonly deliveryConvergenceReviews
  readonly convergenceRepairBaselines
  readonly convergenceRepairCarryItems
  readonly convergenceCarryValidations
  readonly taskPreflightsV3
  readonly planApprovalsV3
  readonly executionDispatches
  private mutationGuard: () => void = () => {}
  private eventAppendTail: Promise<void> = Promise.resolve()

  constructor(readonly domain: Domain<typeof orchestratorDomain>) {
    this.agents = domain.table('agents')
    this.projects = domain.table('projects')
    this.tasks = domain.table('tasks')
    this.approvals = domain.table('approvals')
    this.runs = domain.table('runs')
    this.runtimes = optionalTable<RuntimeRecord>(domain, 'runtimes')
    this.resources = optionalTable<ProjectResource>(domain, 'resources')
    this.issues = optionalTable<IssueRecord>(domain, 'issues')
    this.taskRuns = optionalTable<TaskRunRecord>(domain, 'task_runs')
    this.activity = optionalTable<ActivityEvent>(domain, 'activity')
    this.domainEvents = optionalTable<DomainEventRecord>(domain, 'domain_events')
    this.comments = optionalTable<CommentRecord>(domain, 'comments')
    this.decisions = optionalTable<DecisionRecord>(domain, 'decisions')
    this.squads = optionalTable<SquadRecord>(domain, 'squads')
    this.delegations = optionalTable<DelegationRecord>(domain, 'delegations')
    this.transcripts = optionalTable<TranscriptEntry>(domain, 'transcripts')
    this.artifacts = optionalTable<ArtifactRecord>(domain, 'artifacts')
    this.commands = optionalTable<CommandRecord>(domain, 'commands')
    this.externalTriggers = optionalTable<ExternalTriggerRecord>(domain, 'external_triggers')
    this.skills = optionalTable<SkillRecord>(domain, 'skills')
    this.localDirectoryLocks = optionalTable<LocalDirectoryLockRecord>(domain, 'local_directory_locks')
    this.workspaceLeases = optionalTable<WorkspaceLeaseRecord>(domain, 'workspace_leases')
    this.workspaceWriterLeases = optionalTable<WorkspaceWriterLeaseRecord>(domain, 'workspace_writer_leases')
    this.taskRunConflictLocks = optionalTable<TaskRunConflictLockRecord>(domain, 'task_run_conflict_locks')
    this.projectAgentMemberships = optionalTable<ProjectAgentMembershipRecord>(domain, 'project_agent_memberships')
    this.projectSquadBindings = optionalTable<ProjectSquadBindingRecord>(domain, 'project_squad_bindings')
    this.projectAgentMembershipSources = optionalTable<ProjectAgentMembershipSourceRecord>(domain, 'project_agent_membership_sources')
    this.featureUsageDaily = optionalTable<FeatureUsageDailyRecord>(domain, 'feature_usage_daily')
    this.planSnapshots = optionalTable<PlanSnapshotRecord>(domain, 'plan_snapshots')
    this.requirementBundles = optionalTable<RequirementBundleRecord>(domain, 'requirement_bundles')
    this.requirementItems = optionalTable<RequirementItemRecord>(domain, 'requirement_items')
    this.requirementDecisions = optionalTable<RequirementDecisionRecord>(domain, 'requirement_decisions')
    this.acceptanceCriteria = optionalTable<AcceptanceCriterionRecord>(domain, 'acceptance_criteria')
    this.verificationEvidence = optionalTable<VerificationEvidenceRecord>(domain, 'verification_evidence')
    this.projectReviews = optionalTable<ProjectReviewRecord>(domain, 'project_reviews')
    this.deliveryRecords = optionalTable<DeliveryRecord>(domain, 'delivery_records')
    this.planningOperations = optionalTable<PlanningOperationRecord>(domain, 'planning_operations')
    this.planningMetricPolicies = optionalTable<PlanningMetricPolicyRecord>(domain, 'planning_metric_policies')
    this.planningMetricPolicyPublishes = optionalTable<PlanningMetricPolicyPublishRecord>(domain, 'planning_metric_policy_publishes')
    this.planningShadowEvaluations = optionalTable<PlanningShadowEvaluationRecord>(domain, 'planning_shadow_evaluations')
    this.planningStageAttempts = optionalTable<PlanningStageAttemptRecord>(domain, 'planning_stage_attempts')
    this.planningCheckpoints = optionalTable<PlanningCheckpointRecord>(domain, 'planning_checkpoints')
    this.storageMutationIntents = optionalTable<StorageMutationIntentRecord>(domain, 'storage_mutation_intents')
    this.planningSourceInputs = optionalTable<PlanningSourceInputRecord>(domain, 'planning_source_inputs')
    this.requirementSourceProfiles = optionalTable<RequirementSourceProfileRecord>(domain, 'requirement_source_profiles')
    this.requirementSourceManifests = optionalTable<RequirementSourceManifestRecord>(domain, 'requirement_source_manifests')
    this.requirementAnalysisProposals = optionalTable<RequirementAnalysisProposalRecord>(domain, 'requirement_analysis_proposals')
    this.planningRepairAttempts = optionalTable<PlanningRepairAttemptRecord>(domain, 'planning_repair_attempts')
    this.sourceDispositionBindings = optionalTable<SourceDispositionBindingRecord>(domain, 'source_disposition_bindings')
    this.acceptanceScenarios = optionalTable<AcceptanceScenarioRecord>(domain, 'acceptance_scenarios')
    this.acceptanceScenarioCoveragePolicies = optionalTable<AcceptanceScenarioCoveragePolicyRecord>(domain, 'acceptance_scenario_coverage_policies')
    this.planningRiskProfiles = optionalTable<PlanningRiskProfileRecord>(domain, 'planning_risk_profiles')
    this.sourcePolicyPrechecks = optionalTable<SourcePolicyPrecheckRecord>(domain, 'source_policy_prechecks')
    this.requirementDecisionOptionEffects = optionalTable<RequirementDecisionOptionEffectRecord>(domain, 'requirement_decision_option_effects')
    this.requirementDecisionPlanningEffects = optionalTable<RequirementDecisionPlanningEffectRecord>(domain, 'requirement_decision_planning_effects')
    this.scenarioCoverageReviews = optionalTable<ScenarioCoverageReviewRecord>(domain, 'scenario_coverage_reviews')
    this.planningReviewsV3 = optionalTable<PlanningReviewRecordV3>(domain, 'planning_reviews_v3')
    this.repositorySnapshotsV3 = optionalTable<RepositoryContextSnapshotV3Record>(domain, 'repository_snapshots_v3')
    this.repositoryStackProfiles = optionalTable<RepositoryStackProfileRecord>(domain, 'repository_stack_profiles')
    this.repositoryEvidenceRetrievalReports = optionalTable<RepositoryEvidenceRetrievalReport>(domain, 'repository_evidence_retrieval_reports')
    this.canonicalTargetBindings = optionalTable<CanonicalTargetBindingRecord>(domain, 'canonical_target_bindings')
    this.repositoryPolicyBaselines = optionalTable<RepositoryPolicyBaselineRecord>(domain, 'repository_policy_baselines')
    this.policyConstraintsV3 = optionalTable<PolicyConstraintRecordV3>(domain, 'policy_constraints_v3')
    this.planningPolicySnapshots = optionalTable<PlanningPolicySnapshotRecord>(domain, 'planning_policy_snapshots')
    this.planningPromptReferenceManifests = optionalTable<PlanningPromptReferenceManifestRecord>(domain, 'planning_prompt_reference_manifests')
    this.requirementCodeBindings = optionalTable<RequirementCodeBindingRecord>(domain, 'requirement_code_bindings')
    this.planningProposalPacks = optionalTable<PlanningProposalPackRecord>(domain, 'planning_proposal_packs')
    this.planningReferenceMaps = optionalTable<PlanningReferenceMapRecord>(domain, 'planning_reference_maps')
    this.policyFulfillments = optionalTable<PolicyFulfillmentRecord>(domain, 'policy_fulfillments')
    this.capabilityDefinitions = optionalTable<CapabilityDefinitionRecord>(domain, 'capability_definitions')
    this.agentCapabilityClaims = optionalTable<AgentCapabilityClaimRecord>(domain, 'agent_capability_claims')
    this.projectCapabilityCatalogSnapshots = optionalTable<ProjectCapabilityCatalogSnapshotRecord>(domain, 'project_capability_catalog_snapshots')
    this.resourceAccessGrants = optionalTable<ResourceAccessGrantRecord>(domain, 'resource_access_grants')
    this.projectAccessGrantSnapshots = optionalTable<ProjectAccessGrantSnapshotRecord>(domain, 'project_access_grant_snapshots')
    this.capabilityRequirementDrafts = optionalTable<CapabilityRequirementDraftRecord>(domain, 'capability_requirement_drafts')
    this.assignmentDrafts = optionalTable<AssignmentDraftRecord>(domain, 'assignment_drafts')
    this.assignmentEvaluations = optionalTable<AssignmentEvaluationRecord>(domain, 'assignment_evaluations')
    this.expectedAssignmentFixtures = optionalTable<ExpectedAssignmentFixtureRecord>(domain, 'expected_assignment_fixtures')
    this.planningMetricReleaseReportCreates = optionalTable<PlanningMetricReleaseReportCreateRecord>(domain, 'planning_metric_release_report_creates')
    this.planningMetricReleaseReports = optionalTable<PlanningMetricReleaseReportRecord>(domain, 'planning_metric_release_reports')
    this.deliveryIntegrationSnapshots = optionalTable<DeliveryIntegrationSnapshotRecord>(domain, 'delivery_integration_snapshots')
    this.integrationInclusionEvidence = optionalTable<IntegrationInclusionEvidenceRecord>(domain, 'integration_inclusion_evidence')
    this.deliveryConvergenceFindings = optionalTable<DeliveryConvergenceFindingRecord>(domain, 'delivery_convergence_findings')
    this.deliveryConvergenceReviews = optionalTable<DeliveryConvergenceReviewRecord>(domain, 'delivery_convergence_reviews')
    this.convergenceRepairBaselines = optionalTable<ConvergenceRepairBaselineRecord>(domain, 'convergence_repair_baselines')
    this.convergenceRepairCarryItems = optionalTable<ConvergenceRepairCarryItemRecord>(domain, 'convergence_repair_carry_items')
    this.convergenceCarryValidations = optionalTable<ConvergenceCarryValidationRecord>(domain, 'convergence_carry_validations')
    this.taskPreflightsV3 = optionalTable<TaskPreflightRecordV3>(domain, 'task_preflights_v3')
    this.planApprovalsV3 = optionalTable<PlanApprovalV3Record>(domain, 'plan_approvals_v3')
    this.executionDispatches = optionalTable<ExecutionDispatchRecord>(domain, 'execution_dispatches')
  }

  installMutationGuard(guard: () => void): void {
    this.mutationGuard = guard
    for (const table of this.mutableTables()) {
      const mutable = table as typeof table & { __workspaceWriterGuardInstalled?: boolean }
      if (mutable.__workspaceWriterGuardInstalled === true) continue
      const put = table.put.bind(table)
      const remove = table.delete.bind(table)
      const update = table.update.bind(table)
      table.put = async (key, value) => { this.mutationGuard(); return put(key, value) }
      table.delete = async (key) => { this.mutationGuard(); return remove(key) }
      table.update = async (key, transform) => { this.mutationGuard(); return update(key, transform) }
      mutable.__workspaceWriterGuardInstalled = true
    }
  }

  private mutableTables(): Array<{ put(key: string, value: any): Promise<void>; delete(key: string): Promise<boolean>; update(key: string, transform: (current: any) => any): Promise<any> }> {
    return [
      this.agents, this.projects, this.tasks, this.approvals, this.runs, this.runtimes, this.resources, this.issues, this.taskRuns, this.activity, this.domainEvents,
      this.comments, this.decisions, this.squads, this.delegations, this.transcripts, this.artifacts, this.commands, this.externalTriggers,
      this.skills, this.localDirectoryLocks, this.workspaceLeases, this.workspaceWriterLeases, this.taskRunConflictLocks,
      this.projectAgentMemberships, this.projectSquadBindings, this.projectAgentMembershipSources, this.featureUsageDaily, this.planSnapshots,
      this.requirementBundles, this.requirementItems, this.requirementDecisions, this.acceptanceCriteria, this.verificationEvidence,
      this.projectReviews, this.deliveryRecords, this.planningOperations, this.planningMetricPolicies, this.planningMetricPolicyPublishes, this.planningShadowEvaluations, this.planningStageAttempts, this.planningCheckpoints, this.storageMutationIntents, this.planningSourceInputs,
      this.requirementSourceProfiles, this.requirementSourceManifests, this.requirementAnalysisProposals, this.planningRepairAttempts,
      this.sourceDispositionBindings, this.acceptanceScenarios,
      this.acceptanceScenarioCoveragePolicies, this.planningRiskProfiles, this.sourcePolicyPrechecks, this.scenarioCoverageReviews,
      this.requirementDecisionOptionEffects, this.requirementDecisionPlanningEffects,
      this.planningReviewsV3, this.repositorySnapshotsV3, this.repositoryStackProfiles, this.repositoryEvidenceRetrievalReports, this.canonicalTargetBindings, this.repositoryPolicyBaselines, this.policyConstraintsV3, this.planningPolicySnapshots,
      this.planningPromptReferenceManifests, this.requirementCodeBindings, this.planningProposalPacks, this.planningReferenceMaps,
      this.policyFulfillments, this.capabilityDefinitions, this.agentCapabilityClaims, this.projectCapabilityCatalogSnapshots,
      this.resourceAccessGrants, this.projectAccessGrantSnapshots, this.capabilityRequirementDrafts, this.assignmentDrafts,
      this.assignmentEvaluations, this.expectedAssignmentFixtures, this.planningMetricReleaseReportCreates, this.planningMetricReleaseReports, this.deliveryIntegrationSnapshots, this.integrationInclusionEvidence,
      this.deliveryConvergenceFindings, this.deliveryConvergenceReviews, this.taskPreflightsV3, this.planApprovalsV3, this.executionDispatches,
      this.convergenceRepairBaselines, this.convergenceRepairCarryItems, this.convergenceCarryValidations,
    ]
  }

  storageCapabilities(): StorageCapabilities {
    return { ...STORAGE_CAPABILITIES }
  }

  unresolvedStorageMutationIntents(projectId?: string): StorageMutationIntentRecord[] {
    return [...this.storageMutationIntents.entries()]
      .map(([, value]) => value)
      .filter((intent) => intent.status !== 'committed' && (projectId === undefined || intent.projectId === projectId))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  }

  async appendDomainEvent(input: Omit<DomainEventRecord, 'eventId' | 'sequence' | 'occurredAt' | 'schemaVersion'> & { eventId?: string; occurredAt?: string }): Promise<DomainEventRecord> {
    const operation = this.eventAppendTail.then(async () => {
      if (input.eventId !== undefined) {
        const existing = this.domainEvents.get(input.eventId)
        if (existing !== undefined) {
          const expected = {
            aggregateType: input.aggregateType, aggregateId: input.aggregateId, eventType: input.eventType, actor: input.actor,
            projectId: input.projectId, operationId: input.operationId, taskRunId: input.taskRunId, payloadRef: input.payloadRef,
            payloadDigest: input.payloadDigest, occurredAt: input.occurredAt,
          }
          const actual = {
            aggregateType: existing.aggregateType, aggregateId: existing.aggregateId, eventType: existing.eventType, actor: existing.actor,
            projectId: existing.projectId, operationId: existing.operationId, taskRunId: existing.taskRunId, payloadRef: existing.payloadRef,
            payloadDigest: existing.payloadDigest, occurredAt: input.occurredAt === undefined ? undefined : existing.occurredAt,
          }
          if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new WorkflowError('domain-event-conflict', 'Domain event id is already bound to a different immutable event.', 409)
          return existing
        }
      }
      const sequence = [...this.domainEvents.entries()].reduce((highest, [, event]) => Math.max(highest, event.sequence), 0) + 1
      const event: DomainEventRecord = DomainEventRecordSchema.parse({
        ...input,
        eventId: input.eventId ?? `event:${sequence}`,
        sequence,
        occurredAt: input.occurredAt ?? new Date().toISOString(),
        schemaVersion: 1,
      })
      await this.domainEvents.put(event.eventId, event)
      return event
    })
    this.eventAppendTail = operation.then(() => undefined, () => undefined)
    return operation
  }

  readDomainEvents(after = 0, limit = 100, projectId?: string): DomainEventPage {
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)))
    const all = [...this.domainEvents.entries()].map(([, event]) => event).sort((left, right) => left.sequence - right.sequence)
    const filtered = all.filter((event) => event.sequence > after && (projectId === undefined || event.projectId === undefined || event.projectId === projectId))
    const events = filtered.slice(0, boundedLimit)
    const latest = all.at(-1)?.sequence ?? 0
    return {
      events,
      nextCursor: String(events.at(-1)?.sequence ?? latest),
      latestCursor: String(latest),
      hasMore: filtered.length > events.length,
    }
  }

  snapshot(): Snapshot {
    const projects = [...this.projects.entries()].map(([, value]) => value).sort(byUpdatedAt)
    const projectIds = new Set(projects.map((project) => project.id))
    const issues = [...this.issues.entries()].map(([, value]) => value).sort(byUpdatedAt)
    const taskRuns = [...this.taskRuns.entries()].map(([, value]) => value).sort(byCreatedAt)
    const runtimes = [...this.runtimes.entries()].map(([, value]) => value).sort(byUpdatedAt)
    const activity = [...this.activity.entries()].map(([, value]) => value).sort(byCreatedAt)
    const comments = [...this.comments.entries()].map(([, value]) => value).sort(byCreatedAt)
    const issueIds = new Set(issues.map((issue) => issue.id))
    const taskRunIds = new Set(taskRuns.map((run) => run.id))
    const activeTaskIds = new Set(projects.flatMap((project) => project.taskIds))
    const planHashes: Record<string, string> = {}
    for (const project of projects) {
      try {
        planHashes[project.id] = planDigest(project, this.projectTasks(project))
      } catch (error) {
        if (!(error instanceof WorkflowError) || error.code !== 'inconsistent-plan') throw error
      }
    }
    return {
      agents: [...this.agents.entries()].map(([, value]) => value).sort(byUpdatedAt),
      projects,
      tasks: [...this.tasks.entries()]
        .filter(([id]) => activeTaskIds.has(id))
        .map(([, value]) => value)
        .sort((left, right) => left.ordinal - right.ordinal),
      approvals: [...this.approvals.entries()]
        .map(([, value]) => value)
        .filter((approval) => projectIds.has(approval.projectId))
        .sort((left, right) => right.approvedAt.localeCompare(left.approvedAt)),
      runs: [...this.runs.entries()]
        .map(([, value]) => value)
        .filter((run) => projectIds.has(run.projectId))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      planHashes,
      runtimes,
      resources: [...this.resources.entries()].map(([, value]) => value).filter((resource) => projectIds.has(resource.projectId)).sort(byUpdatedAt),
      issues: issues.filter((issue) => issue.projectId === undefined || projectIds.has(issue.projectId)),
      taskRuns: taskRuns.filter((run) => projectIds.has(run.projectId)),
      activity: activity.filter((event) => event.projectId === undefined || projectIds.has(event.projectId)),
      eventCursor: String([...this.domainEvents.entries()].reduce((highest, [, event]) => Math.max(highest, event.sequence), 0)),
      comments: comments.filter((comment) => issues.some((issue) => issue.id === comment.issueId)),
      decisions: [...this.decisions.entries()]
        .map(([, value]) => value)
        .filter((decision) => (decision.projectId === undefined || projectIds.has(decision.projectId)) && (decision.issueId === undefined || issueIds.has(decision.issueId)) && (decision.taskRunId === undefined || taskRunIds.has(decision.taskRunId)))
        .sort(byCreatedAt),
      squads: [...this.squads.entries()].map(([, value]) => value).sort(byUpdatedAt),
      delegations: [...this.delegations.entries()]
        .map(([, value]) => value)
        .filter((delegation) => projectIds.has(delegation.projectId) && issueIds.has(delegation.parentIssueId) && issueIds.has(delegation.childIssueId))
        .sort(byUpdatedAt),
      transcripts: [...this.transcripts.entries()]
        .map(([, value]) => value)
        .filter((entry) => taskRunIds.has(entry.taskRunId))
        .sort((left, right) => left.taskRunId.localeCompare(right.taskRunId) || left.sequence - right.sequence),
      artifacts: [...this.artifacts.entries()]
        .map(([, value]) => value)
        .filter((artifact) => projectIds.has(artifact.projectId) && (artifact.issueId === undefined || issueIds.has(artifact.issueId)) && (artifact.taskRunId === undefined || taskRunIds.has(artifact.taskRunId)))
        .sort(byCreatedAt),
      commands: [...this.commands.entries()]
        .map(([, value]) => value)
        .filter((command) => (command.projectId === undefined || projectIds.has(command.projectId)) && (command.issueId === undefined || issueIds.has(command.issueId)))
        .sort(byCreatedAt),
      externalTriggers: [...this.externalTriggers.entries()].map(([, value]) => value).sort((left, right) => right.receivedAt.localeCompare(left.receivedAt)),
      skills: [...this.skills.entries()].map(([, value]) => value).sort(byUpdatedAt),
      workspaceLeases: [...this.workspaceLeases.entries()].map(([, value]) => value).filter((lease) => projectIds.has(lease.projectId)).sort((left, right) => right.acquiredAt.localeCompare(left.acquiredAt)),
      localDirectoryLocks: [...this.localDirectoryLocks.entries()].map(([, value]) => value).filter((lock) => projectIds.has(lock.projectId)).sort((left, right) => right.acquiredAt.localeCompare(left.acquiredAt)),
      projectAgentMemberships: [...this.projectAgentMemberships.entries()].map(([, value]) => value).filter((membership) => projectIds.has(membership.projectId)).sort(byUpdatedAt),
      projectSquadBindings: [...this.projectSquadBindings.entries()].map(([, value]) => value).filter((binding) => projectIds.has(binding.projectId)).sort(byUpdatedAt),
      projectAgentMembershipSources: [...this.projectAgentMembershipSources.entries()].map(([, value]) => value).filter((source) => projectIds.has(source.projectId)).sort(byUpdatedAt),
      featureUsageDaily: [...this.featureUsageDaily.entries()].map(([, value]) => value).sort((left, right) => right.date.localeCompare(left.date) || left.feature.localeCompare(right.feature)),
      planSnapshots: [...this.planSnapshots.entries()].map(([, value]) => value).filter((snapshot) => projectIds.has(snapshot.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      requirementBundles: [...this.requirementBundles.entries()].map(([, value]) => value).filter((bundle) => projectIds.has(bundle.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      requirementItems: [...this.requirementItems.entries()].map(([, value]) => value).filter((item) => projectIds.has(item.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      requirementDecisions: [...this.requirementDecisions.entries()].map(([, value]) => value).filter((decision) => projectIds.has(decision.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      acceptanceCriteria: [...this.acceptanceCriteria.entries()].map(([, value]) => value).filter((criterion) => projectIds.has(criterion.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      verificationEvidence: [...this.verificationEvidence.entries()].map(([, value]) => value).filter((evidence) => projectIds.has(evidence.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      projectReviews: [...this.projectReviews.entries()].map(([, value]) => value).filter((review) => projectIds.has(review.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      deliveryRecords: [...this.deliveryRecords.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      planningOperations: [...this.planningOperations.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      planningMetricPolicies: [...this.planningMetricPolicies.entries()].map(([, value]) => value).filter((record) => record.scopeProjectId === undefined || projectIds.has(record.scopeProjectId)).sort((left, right) => right.scopeRevision - left.scopeRevision),
      planningMetricPolicyPublishes: [...this.planningMetricPolicyPublishes.entries()].map(([, value]) => value).filter((record) => record.scopeProjectId === undefined || projectIds.has(record.scopeProjectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      planningShadowEvaluations: [...this.planningShadowEvaluations.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      planningStageAttempts: [...this.planningStageAttempts.entries()].map(([, value]) => value).filter((record) => {
        const operation = this.planningOperations.get(record.operationId)
        return operation !== undefined && projectIds.has(operation.projectId)
      }).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      planningCheckpoints: [...this.planningCheckpoints.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.sequence - left.sequence),
      storageMutationIntents: [...this.storageMutationIntents.entries()].map(([, value]) => value).filter((record) => record.projectId === undefined || projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      planningSourceInputs: [...this.planningSourceInputs.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      requirementSourceProfiles: [...this.requirementSourceProfiles.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      requirementSourceManifests: [...this.requirementSourceManifests.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      requirementAnalysisProposals: [...this.requirementAnalysisProposals.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      planningRepairAttempts: [...this.planningRepairAttempts.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      sourceDispositionBindings: [...this.sourceDispositionBindings.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      acceptanceScenarios: [...this.acceptanceScenarios.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      acceptanceScenarioCoveragePolicies: [...this.acceptanceScenarioCoveragePolicies.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      planningRiskProfiles: [...this.planningRiskProfiles.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      sourcePolicyPrechecks: [...this.sourcePolicyPrechecks.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      requirementDecisionOptionEffects: [...this.requirementDecisionOptionEffects.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      requirementDecisionPlanningEffects: [...this.requirementDecisionPlanningEffects.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      scenarioCoverageReviews: [...this.scenarioCoverageReviews.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      planningReviewsV3: [...this.planningReviewsV3.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      repositorySnapshotsV3: [...this.repositorySnapshotsV3.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      repositoryStackProfiles: [...this.repositoryStackProfiles.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      repositoryEvidenceRetrievalReports: [...this.repositoryEvidenceRetrievalReports.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      canonicalTargetBindings: [...this.canonicalTargetBindings.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      repositoryPolicyBaselines: [...this.repositoryPolicyBaselines.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      policyConstraintsV3: [...this.policyConstraintsV3.entries()].map(([, value]) => value).filter((record) => {
        const snapshot = this.planningPolicySnapshots.get(record.policySnapshotId)
        return snapshot !== undefined && projectIds.has(snapshot.projectId)
      }).sort((left, right) => left.id.localeCompare(right.id)),
      planningPolicySnapshots: [...this.planningPolicySnapshots.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      planningPromptReferenceManifests: [...this.planningPromptReferenceManifests.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      requirementCodeBindings: [...this.requirementCodeBindings.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      planningProposalPacks: [...this.planningProposalPacks.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      planningReferenceMaps: [...this.planningReferenceMaps.entries()].map(([, value]) => value).filter((record) => {
        const operation = this.planningOperations.get(record.operationId)
        return operation !== undefined && projectIds.has(operation.projectId)
      }).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      policyFulfillments: [...this.policyFulfillments.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      capabilityDefinitions: [...this.capabilityDefinitions.entries()].map(([, value]) => value).sort((left, right) => left.id.localeCompare(right.id) || left.version - right.version),
      agentCapabilityClaims: [...this.agentCapabilityClaims.entries()].map(([, value]) => value).filter((record) => record.projectId === undefined || projectIds.has(record.projectId)).sort((left, right) => left.agentId.localeCompare(right.agentId) || left.capabilityId.localeCompare(right.capabilityId)),
      projectCapabilityCatalogSnapshots: [...this.projectCapabilityCatalogSnapshots.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      resourceAccessGrants: [...this.resourceAccessGrants.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.validFrom.localeCompare(left.validFrom)),
      projectAccessGrantSnapshots: [...this.projectAccessGrantSnapshots.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      capabilityRequirementDrafts: [...this.capabilityRequirementDrafts.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      assignmentDrafts: [...this.assignmentDrafts.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      assignmentEvaluations: [...this.assignmentEvaluations.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      expectedAssignmentFixtures: [...this.expectedAssignmentFixtures.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      planningMetricReleaseReportCreates: [...this.planningMetricReleaseReportCreates.entries()].map(([, value]) => value).filter((record) => record.projectId === undefined || projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      planningMetricReleaseReports: [...this.planningMetricReleaseReports.entries()].map(([, value]) => value).filter((record) => record.projectId === undefined || projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      taskPreflightsV3: [...this.taskPreflightsV3.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      planApprovalsV3: [...this.planApprovalsV3.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.approvedAt.localeCompare(left.approvedAt)),
      executionDispatches: [...this.executionDispatches.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      deliveryIntegrationSnapshots: [...this.deliveryIntegrationSnapshots.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      integrationInclusionEvidence: [...this.integrationInclusionEvidence.entries()].map(([, value]) => value).filter((record) => {
        const integration = this.deliveryIntegrationSnapshots.get(record.integrationSnapshotId)
        return integration !== undefined && projectIds.has(integration.projectId)
      }).sort((left, right) => left.integrationSnapshotId.localeCompare(right.integrationSnapshotId) || left.sequence - right.sequence),
      deliveryConvergenceFindings: [...this.deliveryConvergenceFindings.entries()].map(([, value]) => value).filter((record) => {
        const review = this.deliveryConvergenceReviews.get(record.reviewId)
        return review !== undefined && projectIds.has(review.projectId)
      }).sort((left, right) => left.reviewId.localeCompare(right.reviewId) || left.id.localeCompare(right.id)),
      deliveryConvergenceReviews: [...this.deliveryConvergenceReviews.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      convergenceRepairBaselines: [...this.convergenceRepairBaselines.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      convergenceRepairCarryItems: [...this.convergenceRepairCarryItems.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => left.repairBaselineId.localeCompare(right.repairBaselineId) || left.id.localeCompare(right.id)),
      convergenceCarryValidations: [...this.convergenceCarryValidations.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => left.successorOperationId.localeCompare(right.successorOperationId) || left.id.localeCompare(right.id)),
      runtimeOverview: {
        defaultHost: { id: 'default-host', name: '本机默认环境', status: 'unstable', capabilities: [], boundAgentCount: [...this.agents.entries()].filter(([, agent]) => agent.status === 'active' && agent.runtimeId === undefined).length },
        customCount: runtimes.filter((runtime) => runtime.lifecycle === 'active').length,
        abnormalCount: runtimes.filter((runtime) => runtime.lifecycle === 'active' && runtime.status !== 'online').length,
        archivedCount: runtimes.filter((runtime) => runtime.lifecycle === 'archived').length,
      },
      inbox: [],
      agentWorkloads: [],
      runStatistics: [],
    }
  }

  projectTasks(project: ProjectRecord): TaskRecord[] {
    if (new Set(project.taskIds).size !== project.taskIds.length) {
      throw new WorkflowError('inconsistent-plan', `Project "${project.id}" contains duplicate task pointers.`, 500)
    }
    return project.taskIds
      .map((id) => {
        const task = this.tasks.get(id)
        if (task === undefined) {
          throw new WorkflowError('inconsistent-plan', `Project "${project.id}" references missing task "${id}".`, 500)
        }
        if (task.projectId !== project.id) {
          throw new WorkflowError('inconsistent-plan', `Task "${id}" does not belong to project "${project.id}".`, 500)
        }
        return task
      })
      .sort((left, right) => left.ordinal - right.ordinal)
  }

  approvalFor(project: ProjectRecord): ApprovalRecord | undefined {
    return this.approvals.get(`${project.id}:${project.revision}`)
  }
}

function optionalTable<T>(domain: Domain<typeof orchestratorDomain>, name: string): any {
  try {
    const table = (domain as any).table(name)
    if (table === undefined) throw new Error(`missing table ${name}`)
    return table
  } catch {
    return {
      __unavailable: true,
      get: () => undefined,
      entries: () => [][Symbol.iterator](),
      put: async () => { throw new WorkflowError('storage-table-unavailable', `Storage table "${name}" is unavailable in this legacy test domain.`, 503) },
      delete: async () => false,
      update: async () => { throw new WorkflowError('storage-table-unavailable', `Storage table "${name}" is unavailable in this legacy test domain.`, 503) },
    } as any
  }
}

function byUpdatedAt<T extends { updatedAt: string }>(left: T, right: T): number {
  return right.updatedAt.localeCompare(left.updatedAt)
}

function byCreatedAt<T extends { createdAt: string }>(left: T, right: T): number {
  return right.createdAt.localeCompare(left.createdAt)
}
