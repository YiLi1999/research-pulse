import { getConcernEngine } from '../src/services/concernEngine.js';

const MAX_BODY_BYTES = 150 * 1024;
const SAFE_REASONS = new Set(['configuration', 'quota', 'auth', 'rate-limit', 'request', 'destination', 'redirect', 'response', 'network', 'timeout']);
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

function parseBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
    throw fail('请发送 JSON 格式的分析请求。', 415);
  }
  if (Number(request.headers['content-length']) > MAX_BODY_BYTES) throw fail('本次分析内容过大，请缩小范围。', 413);
  let body = request.body;
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw fail('本次分析内容过大，请缩小范围。', 413);
    try { body = JSON.parse(body); } catch { throw fail('分析请求格式不正确。'); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('分析请求格式不正确。');
  if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) throw fail('本次分析内容过大，请缩小范围。', 413);
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 32
      || body.messages.some(message => !message || !['system', 'user', 'assistant'].includes(message.role)
        || typeof message.content !== 'string' || !message.content.trim())) {
    throw fail('分析消息格式不正确。');
  }
  if (body.api == null) throw fail('请先填写你自己的 API 地址、API Key 和模型名称。');
  return body;
}

function isSameOrigin(request) {
  const origin = request.headers.origin, host = request.headers.host;
  if (typeof origin !== 'string' || typeof host !== 'string' || request.headers['sec-fetch-site'] === 'cross-site') return false;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.origin === origin && url.host === host;
  } catch { return false; }
}

// A single awaited model request per invocation. No jobs, disk writes, crawling,
// request-body logging, owner credentials, or fire-and-forget background work.
export function createChatHandler({ getEngine = getConcernEngine } = {}) {
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      response.status(405).json({ error: '请使用 POST 发起分析。' }); return;
    }
    if (!isSameOrigin(request)) {
      response.status(403).json({ error: '请从本站 HTTPS 页面发起分析。' }); return;
    }
    let body;
    try { body = parseBody(request); }
    catch (error) { response.status(error.statusCode || 400).json({ error: error.message }); return; }
    try {
      const engine = await getEngine(body.api);
      if (!engine.available) throw fail('请填写你自己的 API 配置。');
      const messages = body.messages.map(({ role, content }) => ({ role, content }));
      const maxTokens = Number(body.options?.maxTokens), timeoutMs = Number(body.options?.timeoutMs);
      const result = await engine.chat(messages, {
        maxTokens: Number.isInteger(maxTokens) && maxTokens > 0 ? Math.min(maxTokens, 16000) : 16000,
        timeoutMs: Number.isInteger(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 180000) : 180000,
        retries: 0
      });
      response.status(200).json({ result });
    } catch (error) {
      const safe = SAFE_REASONS.has(error.reason);
      const status = safe && Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : 502;
      response.status(status).json({ error: safe ? error.message : '模型分析失败，请检查个人 API 配置后重试。', ...(safe ? { reason: error.reason } : {}) });
    }
  };
}

export default createChatHandler();
