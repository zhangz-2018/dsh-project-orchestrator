import assert from 'node:assert/strict'
import test from 'node:test'
import { buildReleaseReviewRequest, readReleaseReviewText } from '../scripts/release-model-route.mjs'

test('independent Gold review uses the configured Responses or Completions wire format', () => {
  const messages = [{ role: 'system', content: 'Review independently.' }, { role: 'user', content: 'Frozen inputs.' }]
  const responses = buildReleaseReviewRequest('openai-responses', 'gpt-6.1-sol', messages, 12000)
  assert.equal(responses.path, '/responses')
  assert.deepEqual(responses.body.input, messages)
  assert.equal(responses.body.max_output_tokens, 12000)
  assert.equal(responses.body.messages, undefined)
  const completions = buildReleaseReviewRequest('openai-completions', 'gpt-6.1-sol', messages, 12000)
  assert.equal(completions.path, '/chat/completions')
  assert.deepEqual(completions.body.messages, messages)
  assert.equal(completions.body.max_tokens, 12000)
  assert.throws(() => buildReleaseReviewRequest('unknown', 'gpt-6.1-sol', messages, 12000))
})

test('Gold response extraction rejects HTML-shaped, truncated, failed and refused results', () => {
  const completed = { status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', status: 'completed', content: [{ type: 'output_text', text: '{"status":"approved"}' }] }] }
  assert.equal(readReleaseReviewText('openai-responses', completed), '{"status":"approved"}')
  assert.throws(() => readReleaseReviewText('openai-responses', {}))
  assert.throws(() => readReleaseReviewText('openai-responses', { ...completed, status: 'incomplete' }))
  assert.throws(() => readReleaseReviewText('openai-responses', { ...completed, error: { code: 'failed' } }))
  assert.throws(() => readReleaseReviewText('openai-responses', { status: 'completed', output: [{ type: 'message', status: 'completed', content: [{ type: 'refusal', refusal: 'Denied' }] }] }))
  const legacy = { choices: [{ finish_reason: 'stop', message: { content: 'approved' } }] }
  assert.equal(readReleaseReviewText('openai-completions', legacy), 'approved')
  assert.throws(() => readReleaseReviewText('openai-completions', { choices: [{ finish_reason: 'length', message: { content: 'approved' } }] }))
})
