#!/usr/bin/env node

import { readFileSync } from 'node:fs'

const VERSION = String(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version)
const USAGE = `dsh-project-orchestrator ${VERSION}\n\nUsage:\n  dsh-project-orchestrator snapshot [--url URL]\n  dsh-project-orchestrator inbox [--url URL]\n  dsh-project-orchestrator stats [--url URL]\n  dsh-project-orchestrator command '<JSON>' [--url URL]\n  dsh-project-orchestrator trigger '<JSON>' [--url URL]\n`

const args = process.argv.slice(2)
const command = args.shift()
const baseUrl = takeOption(args, '--url') ?? process.env.DSH_PROJECT_ORCHESTRATOR_URL ?? 'http://127.0.0.1:3080/project-orchestrator/api'

try {
  if (command === '--help' || command === '-h' || command === undefined) {
    process.stdout.write(USAGE)
  } else if (command === '--version' || command === '-v') {
    process.stdout.write(`${VERSION}\n`)
  } else if (command === 'snapshot') {
    print(await request('/snapshot'))
  } else if (command === 'inbox') {
    print(await request('/inbox'))
  } else if (command === 'stats') {
    print(await request('/stats'))
  } else if (command === 'command') {
    print(await request('/commands', parseJsonArgument(args)))
  } else if (command === 'trigger') {
    print(await request('/external-triggers', parseJsonArgument(args)))
  } else {
    process.stderr.write(USAGE)
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
