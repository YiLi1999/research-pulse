import { chatJson } from '../summarizer/llmClient.js';
import { validateVisitorApi, visitorFetch } from './visitorApi.js';

const unavailableMessage = '请先填写你自己的 API 地址（Base URL）、API Key 和模型名称，再开始趋势分析；领域发文统计仍可使用。';
const safeReasons = new Set(['quota', 'auth', 'rate-limit', 'request', 'destination', 'redirect', 'response', 'network', 'timeout', 'configuration']);

export async function getConcernEngine(api, { fetch = visitorFetch } = {}) {
  if (api == null) {
    return { available: false, provider: 'api', model: '', label: 'API · 待填写',
      signature: ['visitor-api', 'unconfigured'], requiresConfiguration: true,
      error: unavailableMessage, concurrency: 2 };
  }
  const connection = { ...validateVisitorApi(api), temperature: 0.2, maxTokens: 16000 };
  return { available: true, provider: 'api', model: connection.model, label: `API · ${connection.model}`,
    signature: ['visitor-api', connection.baseUrl, connection.model], concurrency: 2,
    requiresConfiguration: true, error: null,
    chat: async (messages, options = {}) => {
      try {
        return await chatJson(messages, { ...options, connection, fetch });
      } catch (error) {
        // Providers may echo prompts or credentials, including in malformed JSON
        // errors. Only our known, generic transport/HTTP errors may leave here.
        if (safeReasons.has(error.reason)) {
          const messages = {
            quota: 'API 额度或余额不足，请检查你自己的 API 账户。',
            auth: 'API Key 验证失败，请检查你填写的密钥。',
            'rate-limit': 'API 请求频率受限，请稍后重试。',
            request: 'API 请求失败，请检查服务地址、密钥与模型名称。',
            destination: 'API 地址无法解析为公网服务，请检查 Base URL。',
            redirect: 'API 服务返回了重定向，请直接填写最终的 HTTPS Base URL。',
            response: 'API 响应过大或无法读取，请缩小分析范围后重试。',
            network: '无法连接 API 服务，请检查地址后重试。',
            timeout: 'API 请求已超时或取消，请稍后重试。',
            configuration: '请检查你填写的 API 地址、API Key 和模型名称。'
          };
          const statusCode = Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : 502;
          throw Object.assign(new Error(messages[error.reason]), { reason: error.reason, statusCode });
        }
        throw Object.assign(new Error('API 返回了无效的分析结果，请确认模型支持 JSON 输出后重试。'), { statusCode: 502 });
      }
    } };
}
