import assert from 'node:assert/strict'

/**
 * 将无工具的 messages 转为指定协议请求，maxTokens 是本次输出 token 上限。
 * 返回相对接口路径和请求体；仅支持已核实的两种协议，未知协议立即拒绝。
 */
export function buildReleaseReviewRequest(api, model, messages, maxTokens) {
  if (api === 'openai-responses') return {
    path: '/responses',
    body: { model, input: messages, max_output_tokens: maxTokens, stream: false },
  }
  assert.equal(api, 'openai-completions', 'Unsupported independent review protocol')
  return {
    path: '/chat/completions',
    body: { model, messages, max_tokens: maxTokens, stream: false },
  }
}

/** 提取完整审阅文本；截断、拒绝、失败或空输出不能作为可批准的 Gold。 */
export function readReleaseReviewText(api, response) {
  let content
  if (api === 'openai-responses') {
    assert.equal(response.status, 'completed', 'Independent review did not complete')
    assert.ok(!response.error, 'Independent review returned an error')
    const messages = response.output?.filter(item => item.type === 'message') ?? []
    assert.ok(messages.every(item => item.status === 'completed'), 'Independent review message is incomplete')
    const blocks = messages.flatMap(item => item.content ?? [])
    assert.ok(!blocks.some(item => item.type === 'refusal'), 'Independent review was refused')
    content = blocks.filter(item => item.type === 'output_text').map(item => item.text).join('\n')
  } else {
    assert.equal(api, 'openai-completions', 'Unsupported independent review protocol')
    const choice = response.choices?.[0]
    assert.equal(choice?.finish_reason, 'stop', 'Independent review did not complete')
    assert.ok(!choice.message?.refusal, 'Independent review was refused')
    content = choice.message?.content
  }
  assert.ok(typeof content === 'string' && content.trim(), 'Independent review text is missing')
  return content.trim()
}
