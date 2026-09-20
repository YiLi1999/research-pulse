import { config } from "../config/index.js";
import { withRetry } from "../utils/retry.js";

export function hasLlmConfig(connection = config.llm) {
  if (!connection.apiKey?.trim() || /^YOUR[_-]/i.test(connection.apiKey) || !connection.model?.trim()) return false;
  try { return ['http:', 'https:'].includes(new URL(connection.baseUrl).protocol); } catch { return false; }
}

function extractJsonObject(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) {
    return fenced[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return text;
}

export async function chatJson(messages, options = {}) {
  const connection = options.connection || config.llm;
  if (!hasLlmConfig(connection)) {
    throw new Error("LLM 未配置。");
  }

  const endpoint = `${connection.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const response = await withRetry(
    async () => {
      const result = await (options.fetch || globalThis.fetch)(endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(options.timeoutMs ?? 120000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${connection.apiKey}`
        },
        body: JSON.stringify({
          model: connection.model,
          temperature: connection.temperature,
          max_tokens: options.maxTokens ?? connection.maxTokens,
          response_format: { type: "json_object" },
          messages
        })
      });

      if (!result.ok) {
        const payload = await result.json().catch(() => ({}));
        const message = String(payload.error?.message || payload.base_resp?.status_msg || "");
        const reason = /quota|insufficient.*(?:balance|credit)|token plan|用量上限|余额不足|额度.*(?:不足|用尽)/i.test(message)
          ? "quota" : [401, 403].includes(result.status) ? "auth" : result.status === 429 ? "rate-limit" : "request";
        // Do not expose provider response bodies or credentials through the API/logs.
        throw Object.assign(new Error(`LLM request failed: HTTP ${result.status} (${reason})`), {
          reason, statusCode: result.status
        });
      }

      return result.json();
    },
    { retries: options.retries ?? 2, delayMs: 2000, shouldRetry: error => error.retryable !== false && !["quota", "auth"].includes(error.reason) }
  );

  const content = response?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM 返回为空。");
  }

  return JSON.parse(extractJsonObject(content));
}
