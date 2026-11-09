import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  planningGoldDigest,
  planningReleaseProvenanceFailures,
  validatePlanningCandidate,
  validatePlanningCanary,
  validatePlanningEvalManifest,
  validatePlanningGold,
} from './contracts.mjs'
import { gradePlanningRun, READINESS_THRESHOLDS, RELEASE_THRESHOLDS, summarizePlanningGrades } from './grader.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const releaseMode = process.argv.includes('--release')
const qualificationFailures = []
const grades = []
const attempts = []
const goldByCase = new Map()
const candidatesByCase = new Map()
const repositoryIdentities = new Set()
const operationIds = new Set()

function argumentValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const selectedCasesArgument = argumentValue('--cases')
if (process.argv.includes('--cases') && selectedCasesArgument === undefined) throw new Error('--cases requires a comma-separated case list.')
if (selectedCasesArgument !== undefined && (releaseMode || process.argv.includes('--manifest'))) throw new Error('Cannot select individual cases for a release manifest; every frozen case and attempt must be evaluated.')

function pathInsideRoot(path) {
  const child = relative(root, path)
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

async function loadGold(caseName) {
  const raw = JSON.parse(await readFile(resolve(root, 'cases', caseName, 'gold.json'), 'utf8'))
  const gold = validatePlanningGold(raw, caseName)
  goldByCase.set(caseName, gold)
  repositoryIdentities.add(gold.repository.identity ?? `${gold.repository.fixture}@${gold.repository.baseCommit}`)
  return { gold, raw }
}

function recordCandidate(caseName, candidate, runName) {
  const gold = goldByCase.get(caseName)
  const caseCandidates = candidatesByCase.get(caseName) ?? []
  if (caseCandidates.some((item) => item.runId === candidate.runId)) qualificationFailures.push(`${caseName} contains duplicate runId ${candidate.runId}.`)
  caseCandidates.push(candidate)
  candidatesByCase.set(caseName, caseCandidates)
  if (candidate.executionKind === 'real_model') {
    qualificationFailures.push(...planningReleaseProvenanceFailures(gold, candidate, runName))
    if (operationIds.has(candidate.provenance.planningOperationId)) qualificationFailures.push(`planning operation ${candidate.provenance.planningOperationId} is reused across evaluation runs.`)
    operationIds.add(candidate.provenance.planningOperationId)
  }
  grades.push(gradePlanningRun(gold, candidate))
}

async function loadSubset() {
  const availableCases = (await readdir(resolve(root, 'cases'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  const caseNames = selectedCasesArgument === undefined ? availableCases : selectedCasesArgument.split(',')
  if (new Set(caseNames).size !== caseNames.length) throw new Error('Selected evaluation cases must be unique.')
  for (const caseName of caseNames) if (!availableCases.includes(caseName)) throw new Error(`Unknown evaluation case: ${caseName}`)
  for (const caseName of caseNames) {
    await loadGold(caseName)
    const runsRoot = resolve(root, 'cases', caseName, 'runs')
    const runNames = (await readdir(runsRoot)).filter((name) => name.endsWith('.json')).sort()
    if (runNames.length < 5) throw new Error(`Evaluation case ${caseName} has ${runNames.length} runs; at least five frozen-input runs are required.`)
    for (const runName of runNames) {
      const candidate = validatePlanningCandidate(JSON.parse(await readFile(resolve(runsRoot, runName), 'utf8')), caseName, runName)
      recordCandidate(caseName, candidate, runName)
      attempts.push({ caseId: caseName, attemptId: `${caseName}/${candidate.runId}`, outcome: 'candidate' })
    }
  }
  return undefined
}

async function loadManifest(path) {
  const manifest = validatePlanningEvalManifest(JSON.parse(await readFile(path, 'utf8')))
  const manifestRoot = dirname(path)
  const candidateRefs = new Set()
  for (const entry of manifest.cases) {
    const { gold, raw } = await loadGold(entry.caseId)
    if (gold.schemaVersion !== 2) qualificationFailures.push(`${entry.caseId} must use Gold V2 for readiness qualification.`)
    if (entry.goldDigest !== planningGoldDigest(raw)) qualificationFailures.push(`${entry.caseId} Gold digest does not match the release manifest.`)
  }
  for (const attempt of manifest.attempts) {
    attempts.push(attempt)
    if (attempt.outcome !== 'candidate') continue
    const candidatePath = resolve(manifestRoot, attempt.candidateRef)
    if (!pathInsideRoot(candidatePath)) throw new Error(`Candidate reference ${attempt.candidateRef} must remain inside planning-evals.`)
    if (candidateRefs.has(candidatePath)) qualificationFailures.push(`candidateRef ${attempt.candidateRef} is reused by multiple attempts.`)
    candidateRefs.add(candidatePath)
    const candidate = validatePlanningCandidate(JSON.parse(await readFile(candidatePath, 'utf8')), attempt.caseId, attempt.candidateRef)
    if (candidate.schemaVersion !== 2) qualificationFailures.push(`${attempt.caseId}/${attempt.attemptId} must reference a V2 candidate with pre-model frozen input.`)
    if (candidate.executionKind !== 'real_model') qualificationFailures.push(`${attempt.caseId}/${attempt.attemptId} must reference a real_model candidate.`)
    if (attempt.operationId === undefined) qualificationFailures.push(`${attempt.caseId}/${attempt.attemptId} candidate attempt has no operationId.`)
    else if (candidate.provenance?.planningOperationId !== attempt.operationId) qualificationFailures.push(`${attempt.caseId}/${attempt.attemptId} operationId does not match candidate provenance.`)
    recordCandidate(attempt.caseId, candidate, attempt.candidateRef)
  }
  return manifest
}

const manifestArgument = argumentValue('--manifest')
const manifestPath = manifestArgument === undefined ? resolve(root, 'release-manifest.json') : resolve(manifestArgument)
let manifest
if (releaseMode || manifestArgument !== undefined) {
  try {
    manifest = await loadManifest(manifestPath)
  } catch (error) {
    qualificationFailures.push(error?.code === 'ENOENT'
      ? `release evaluation manifest is missing at ${manifestPath}`
      : `release evaluation manifest is invalid: ${error instanceof Error ? error.message : String(error)}`)
    await loadSubset()
  }
} else {
  await loadSubset()
}

if (manifest !== undefined) {
  const goldCases = [...goldByCase.values()]
  const readyCases = goldCases.filter((gold) => gold.expectedReadiness === 'ready')
  const blockedCases = goldCases.filter((gold) => gold.expectedReadiness === 'blocked')
  if (readyCases.length === 0) qualificationFailures.push('release corpus requires at least one Gold ready case.')
  if (blockedCases.length === 0) qualificationFailures.push('release corpus requires at least one Gold blocked case.')
  const pairedCases = goldCases.filter((gold) => gold.pairedCaseId !== undefined)
  if (pairedCases.length === 0) qualificationFailures.push('release corpus requires a ready/blocked paired case.')
  for (const gold of pairedCases) {
    const paired = goldByCase.get(gold.pairedCaseId)
    if (paired === undefined) qualificationFailures.push(`${gold.id} references missing paired case ${gold.pairedCaseId}.`)
    else if (paired.expectedReadiness === gold.expectedReadiness) qualificationFailures.push(`${gold.id} and ${paired.id} must have different expectedReadiness values.`)
  }
  for (const caseId of goldByCase.keys()) {
    const realCandidates = (candidatesByCase.get(caseId) ?? []).filter((candidate) => candidate.executionKind === 'real_model')
    if (realCandidates.length < 5) qualificationFailures.push(`${caseId} requires at least five valid real-model candidates; found ${realCandidates.length}.`)
  }
  for (const metric of ['falseBlockedRate', 'modelFailureRate']) {
    if (manifest.metricPolicy.thresholds[metric] === undefined) qualificationFailures.push(`MetricPolicy must freeze a ${metric} threshold.`)
  }
}

const thresholds = manifest === undefined
  ? undefined
  : { ...RELEASE_THRESHOLDS, ...READINESS_THRESHOLDS, ...manifest.metricPolicy.thresholds }
const aggregate = summarizePlanningGrades(grades, { attempts, thresholds })
qualificationFailures.push(
  ...(repositoryIdentities.size >= 8 ? [] : [`corpus requires at least 8 unique repositories; found ${repositoryIdentities.size}`]),
  ...(goldByCase.size >= 24 ? [] : [`corpus requires at least 24 requirement samples; found ${goldByCase.size}`]),
)

const packageManifest = JSON.parse(await readFile(resolve(root, '..', 'package.json'), 'utf8'))
const canaryPath = argumentValue('--canary') === undefined ? resolve(root, 'canary', 'release.json') : resolve(argumentValue('--canary'))
let canary
try {
  canary = validatePlanningCanary(JSON.parse(await readFile(canaryPath, 'utf8')), packageManifest.version)
  if (canary.schemaVersion !== 2) qualificationFailures.push('release qualification requires a schemaVersion 2 canary with verification and human delivery evidence.')
} catch (error) {
  if (error?.code === 'ENOENT') qualificationFailures.push(`release canary evidence is missing at ${canaryPath}`)
  else qualificationFailures.push(`release canary evidence is invalid: ${error instanceof Error ? error.message : String(error)}`)
}

const summary = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  corpusCaseCount: goldByCase.size,
  repositoryCount: repositoryIdentities.size,
  requirementSampleCount: goldByCase.size,
  attemptCount: attempts.length,
  validCandidateCount: grades.length,
  modelFailureCount: attempts.filter((attempt) => attempt.outcome === 'model_failure').length,
  realModelRunCount: [...candidatesByCase.values()].flat().filter((candidate) => candidate.executionKind === 'real_model').length,
  grades,
  aggregate,
  ...(manifest === undefined ? {} : { batchId: manifest.batchId, metricPolicy: manifest.metricPolicy }),
  ...(canary === undefined ? {} : { canary }),
  releaseQualification: { passed: manifest !== undefined && aggregate.passed && qualificationFailures.length === 0, failures: [...new Set(qualificationFailures)] },
}
const outputArgument = argumentValue('--output')
if (outputArgument !== undefined) {
  const output = resolve(outputArgument)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`)
}
console.log(JSON.stringify({ aggregate: summary.aggregate, releaseQualification: summary.releaseQualification }, null, 2))
if (!summary.aggregate.passed || (releaseMode && !summary.releaseQualification.passed)) process.exitCode = 1
