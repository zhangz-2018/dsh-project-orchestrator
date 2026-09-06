import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { planningReleaseProvenanceFailures, validatePlanningCandidate, validatePlanningCanary, validatePlanningGold } from './contracts.mjs'
import { gradePlanningRun, summarizePlanningGrades } from './grader.mjs'

const root = resolve(new URL('.', import.meta.url).pathname)
const caseNames = (await readdir(join(root, 'cases'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
const grades = []
let requirementSampleCount = 0
let realModelRunCount = 0
const qualificationFailures = []
const repositoryIdentities = new Set()
for (const caseName of caseNames) {
  const caseRoot = join(root, 'cases', caseName)
  const gold = validatePlanningGold(JSON.parse(await readFile(join(caseRoot, 'gold.json'), 'utf8')), caseName)
  requirementSampleCount += 1
  repositoryIdentities.add(gold.repository.identity ?? `${gold.repository.fixture}@${gold.repository.baseCommit}`)
  const runNames = (await readdir(join(caseRoot, 'runs'))).filter((name) => name.endsWith('.json')).sort()
  if (runNames.length < 5) throw new Error(`Evaluation case ${caseName} has ${runNames.length} runs; at least five frozen-input runs are required.`)
  const caseRunIds = new Set()
  const caseOperationIds = new Set()
  for (const runName of runNames) {
    const candidate = validatePlanningCandidate(JSON.parse(await readFile(join(caseRoot, 'runs', runName), 'utf8')), caseName, runName)
    if (caseRunIds.has(candidate.runId)) qualificationFailures.push(`${caseName} contains duplicate runId ${candidate.runId}.`)
    caseRunIds.add(candidate.runId)
    if (candidate.executionKind === 'real_model') {
      realModelRunCount += 1
      qualificationFailures.push(...planningReleaseProvenanceFailures(gold, candidate, runName))
      if (caseOperationIds.has(candidate.provenance.planningOperationId)) qualificationFailures.push(`${caseName} reuses planning operation ${candidate.provenance.planningOperationId} across real-model runs.`)
      caseOperationIds.add(candidate.provenance.planningOperationId)
    }
    grades.push(gradePlanningRun(gold, candidate))
  }
}
const aggregate = summarizePlanningGrades(grades)
qualificationFailures.push(
  ...(repositoryIdentities.size >= 8 ? [] : [`corpus requires at least 8 unique repositories; found ${repositoryIdentities.size}`]),
  ...(requirementSampleCount >= 24 ? [] : [`corpus requires at least 24 requirement samples; found ${requirementSampleCount}`]),
  ...(realModelRunCount === grades.length ? [] : [`every graded run must be a real_model run; found ${realModelRunCount}/${grades.length}`]),
)
const packageManifest = JSON.parse(await readFile(join(root, '..', 'package.json'), 'utf8'))
const canaryIndex = process.argv.indexOf('--canary')
const canaryPath = canaryIndex >= 0 ? resolve(process.argv[canaryIndex + 1]) : join(root, 'canary', 'release.json')
let canary
try {
  canary = validatePlanningCanary(JSON.parse(await readFile(canaryPath, 'utf8')), packageManifest.version)
} catch (error) {
  if (error?.code === 'ENOENT') qualificationFailures.push(`release canary evidence is missing at ${canaryPath}`)
  else qualificationFailures.push(`release canary evidence is invalid: ${error instanceof Error ? error.message : String(error)}`)
}
const summary = { schemaVersion: 1, generatedAt: new Date().toISOString(), corpusCaseCount: caseNames.length, repositoryCount: repositoryIdentities.size, requirementSampleCount, realModelRunCount, grades, aggregate, ...(canary === undefined ? {} : { canary }), releaseQualification: { passed: aggregate.passed && qualificationFailures.length === 0, failures: [...new Set(qualificationFailures)] } }
const outputIndex = process.argv.indexOf('--output')
if (outputIndex >= 0) {
  const output = resolve(process.argv[outputIndex + 1])
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`)
}
console.log(JSON.stringify({ aggregate: summary.aggregate, releaseQualification: summary.releaseQualification }, null, 2))
if (!summary.aggregate.passed || (process.argv.includes('--release') && !summary.releaseQualification.passed)) process.exitCode = 1
