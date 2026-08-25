#!/usr/bin/env node

import { readFileSync } from 'node:fs'

const VERSION = String(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version)
const USAGE = `dsh-project-orchestrator ${VERSION}\n\nUsage:\n  dsh-project-orchestrator snapshot [--url URL]\n  dsh-project-orchestrator inbox [--url URL]\n  dsh-project-orchestrator stats [--url URL]\n  dsh-project-orchestrator team-plan PROJECT_ID [--url URL]\n  dsh-project-orchestrator agent-candidates PROJECT_ID TASK_ID [--url URL]\n  dsh-project-orchestrator team-impact PROJECT_ID [--url URL]\n  dsh-project-orchestrator team-metrics [PROJECT_ID] [--url URL]\n  dsh-project-orchestrator validate-team PROJECT_ID [--url URL]\n  dsh-project-orchestrator reassign-task PROJECT_ID '<JSON>' [--url URL]\n  dsh-project-orchestrator resolve-team-blocker PROJECT_ID '<JSON>' [--url URL]\n  dsh-project-orchestrator bind-project-squad PROJECT_ID '<JSON>' [--url URL]\n  dsh-project-orchestrator sync-project-squad PROJECT_ID SQUAD_ID '<JSON>' [--url URL]\n  dsh-project-orchestrator plan-snapshots PROJECT_ID [--url URL]\n  dsh-project-orchestrator requirements PROJECT_ID [--url URL]\n  dsh-project-orchestrator decisions PROJECT_ID [--url URL]\n  dsh-project-orchestrator delivery PROJECT_ID [--url URL]\n  dsh-project-orchestrator confirm-delivery PROJECT_ID ACTOR [NOTE] [--url URL]\n  dsh-project-orchestrator command '<JSON>' [--url URL]\n  dsh-project-orchestrator trigger '<JSON>' [--url URL]\n`

const args = process.argv.slice(2)
const command = args.shift()
const baseUrl = takeOption(args, '--url') ?? process.env.DSH_PROJECT_ORCHESTRATOR_URL ?? 'http://127.0.0.1:3080/project-orchestrator/api'
const DELIVERY_USAGE = "  dsh-project-orchestrator resolve-review PROJECT_ID '<JSON>' [--url URL]\n  dsh-project-orchestrator close-delivery PROJECT_ID ACTOR [NOTE] [--url URL]\n"

try {
  if (command === '--help' || command === '-h' || command === undefined) {
    process.stdout.write(`${USAGE}${DELIVERY_USAGE}`)
  } else if (command === '--version' || command === '-v') {
    process.stdout.write(`${VERSION}\n`)
  } else if (command === 'snapshot') {
    print(await request('/snapshot'))
  } else if (command === 'inbox') {
    print(await request('/inbox'))
  } else if (command === 'stats') {
    print(await request('/stats'))
  } else if (command === 'team-plan') {
    const projectId = args.shift()
    if (projectId === undefined || projectId.trim() === '') throw new Error('team-plan requires a PROJECT_ID.')
    print(await request(`/projects/${encodeURIComponent(projectId)}/team-plan`))
  } else if (command === 'agent-candidates') {
    const projectId = args.shift()
    const taskId = args.shift()
    if (projectId === undefined || taskId === undefined) throw new Error('agent-candidates requires PROJECT_ID and TASK_ID.')
    print(await request(`/projects/${encodeURIComponent(projectId)}/agent-candidates?taskId=${encodeURIComponent(taskId)}`))
  } else if (command === 'team-impact') {
    const projectId = args.shift()
    if (projectId === undefined || projectId.trim() === '') throw new Error('team-impact requires a PROJECT_ID.')
    print(await request(`/projects/${encodeURIComponent(projectId)}/team-impact`))
  } else if (command === 'team-metrics') {
    const projectId = args.shift()
    print(await request(projectId === undefined ? '/team-metrics' : `/projects/${encodeURIComponent(projectId)}/team-metrics`))
  } else if (command === 'validate-team') {
    const projectId = args.shift()
    if (projectId === undefined || projectId.trim() === '') throw new Error('validate-team requires a PROJECT_ID.')
    print(await request(`/projects/${encodeURIComponent(projectId)}/validate-team`, {}))
  } else if (command === 'reassign-task') {
    const projectId = args.shift()
    if (projectId === undefined || args.length === 0) throw new Error('reassign-task requires PROJECT_ID and a JSON body.')
    print(await request(`/projects/${encodeURIComponent(projectId)}/reassign-task`, parseJsonArgument(args)))
  } else if (command === 'resolve-team-blocker') {
    const projectId = args.shift()
    if (projectId === undefined || args.length === 0) throw new Error('resolve-team-blocker requires PROJECT_ID and a JSON body.')
    print(await request(`/projects/${encodeURIComponent(projectId)}/resolve-team-blocker`, parseJsonArgument(args)))
  } else if (command === 'bind-project-squad') {
    const projectId = args.shift()
    if (projectId === undefined || args.length === 0) throw new Error('bind-project-squad requires PROJECT_ID and a JSON body.')
    print(await request(`/projects/${encodeURIComponent(projectId)}/squad-bindings`, parseJsonArgument(args)))
  } else if (command === 'sync-project-squad') {
    const projectId = args.shift()
    const squadId = args.shift()
    if (projectId === undefined || squadId === undefined || args.length === 0) throw new Error('sync-project-squad requires PROJECT_ID, SQUAD_ID, and a JSON body.')
    print(await request(`/projects/${encodeURIComponent(projectId)}/squad-bindings/${encodeURIComponent(squadId)}/sync`, parseJsonArgument(args)))
  } else if (command === 'plan-snapshots') {
    const projectId = args.shift()
    if (projectId === undefined || projectId.trim() === '') throw new Error('plan-snapshots requires a PROJECT_ID.')
    print(await request(`/projects/${encodeURIComponent(projectId)}/plan-snapshots`))
  } else if (command === 'requirements') {
    const projectId = args.shift()
    if (projectId === undefined || projectId.trim() === '') throw new Error('requirements requires a PROJECT_ID.')
    print(await request(`/projects/${encodeURIComponent(projectId)}/requirements`))
  } else if (command === 'decisions') {
    const projectId = args.shift()
    if (projectId === undefined || projectId.trim() === '') throw new Error('decisions requires a PROJECT_ID.')
    print(await request(`/projects/${encodeURIComponent(projectId)}/requirement-decisions`))
  } else if (command === 'delivery') {
    const projectId = args.shift()
    if (projectId === undefined || projectId.trim() === '') throw new Error('delivery requires a PROJECT_ID.')
    print(await request(`/projects/${encodeURIComponent(projectId)}/delivery`))
  } else if (command === 'confirm-delivery') {
    const projectId = args.shift()
    const actor = args.shift()
    if (projectId === undefined || projectId.trim() === '' || actor === undefined || actor.trim() === '') throw new Error('confirm-delivery requires PROJECT_ID and ACTOR.')
    print(await request(`/projects/${encodeURIComponent(projectId)}/delivery/confirm`, { actor, ...(args.length === 0 ? {} : { note: args.join(' ') }) }))
  } else if (command === 'resolve-review') {
    const projectId = args.shift()
    if (projectId === undefined || projectId.trim() === '') throw new Error('resolve-review requires a PROJECT_ID.')
    print(await request(`/projects/${encodeURIComponent(projectId)}/review/resolve`, parseJsonArgument(args)))
  } else if (command === 'close-delivery') {
    const projectId = args.shift()
    const actor = args.shift()
    if (projectId === undefined || projectId.trim() === '' || actor === undefined || actor.trim() === '') throw new Error('close-delivery requires PROJECT_ID and ACTOR.')
    print(await request(`/projects/${encodeURIComponent(projectId)}/delivery/close`, { actor, ...(args.length === 0 ? {} : { note: args.join(' ') }) }))
  } else if (command === 'command') {
    print(await request('/commands', parseJsonArgument(args)))
  } else if (command === 'trigger') {
    print(await request('/external-triggers', parseJsonArgument(args)))
  } else {
    process.stderr.write(`${USAGE}${DELIVERY_USAGE}`)
    process.exitCode = 2
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}

function takeOption(values: string[], name: string): string | undefined {
  const index = values.indexOf(name)
  if (index < 0) return undefined
  const value = values[index + 1]
  if (value === undefined) throw new Error(`${name} requires a value.`)
  values.splice(index, 2)
  return value
}

function parseJsonArgument(values: string[]): unknown {
  const raw = values[0]
  if (raw === undefined) throw new Error('This command requires one JSON argument.')
  try { return JSON.parse(raw) } catch (error) { throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`) }
}

async function request(path: string, body?: unknown): Promise<unknown> {
  const endpoint = new URL(`${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`)
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(endpoint.hostname)) throw new Error('The CLI only connects to a loopback Harness API.')
  const response = await fetch(endpoint, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: endpoint.origin, 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let payload: any
  try { payload = text === '' ? {} : JSON.parse(text) } catch { throw new Error(`Harness returned non-JSON HTTP ${response.status}.`) }
  if (!response.ok) throw new Error(`${payload?.error?.code ?? `HTTP ${response.status}`}: ${payload?.error?.message ?? 'Request failed.'}`)
  return payload
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}
