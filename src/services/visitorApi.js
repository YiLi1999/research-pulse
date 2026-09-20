import { lookup as resolveDns } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

function apiError(message, reason = 'configuration', statusCode = 400) {
  return Object.assign(new Error(message), { reason, statusCode, retryable: false });
}

const blockedV4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
]) blockedV4.addSubnet(address, prefix, 'ipv4');

const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const blockedV6 = new BlockList();
for (const [address, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]
]) blockedV6.addSubnet(address, prefix, 'ipv6');

// Permit globally routable destinations only, including when DNS returns a mix
// of public and private records. IPv4-mapped and transition IPv6 are not allowed.
export function isPublicAddress(address) {
  if (typeof address !== 'string') return false;
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, 'ipv4');
  return family === 6 && globalV6.check(address, 'ipv6') && !blockedV6.check(address, 'ipv6');
}

function destinationUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw apiError('API 地址格式不正确，请填写 HTTPS Base URL。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || /[?#]/.test(value)) {
    throw apiError('API 地址必须使用 HTTPS，且不能包含用户名、密码、查询参数或片段。');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw apiError('API 地址必须指向公网服务，不能使用本机或内网地址。', 'destination');
  } else if (!hostname.includes('.') || !/^[a-z0-9.-]+$/.test(hostname)
      || hostname.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
      || /(?:^|\.)(?:localhost|local|internal|lan|test|invalid|onion)$/.test(hostname)
      || /(?:^|\.)home\.arpa$/.test(hostname)) {
    throw apiError('API 地址必须使用有效的公网域名。', 'destination');
  }
  return url;
}

export function validateVisitorApi(api) {
  if (!api || typeof api !== 'object' || Array.isArray(api)) {
    throw apiError('请填写你自己的 API 地址、API Key 和模型名称。');
  }
  const connection = {};
  for (const [field, label, maxLength] of [['baseUrl', 'API 地址', 2048], ['apiKey', 'API Key', 4096], ['model', '模型名称', 200]]) {
    const value = api[field];
    if (typeof value !== 'string' || !value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
      throw apiError(`请填写有效的${label}（最长 ${maxLength} 个字符，不能包含换行或控制字符）。`);
    }
    connection[field] = value.trim();
  }
  if (/[^\x21-\x7e]/.test(connection.apiKey) || /^YOUR[_-]/i.test(connection.apiKey)) {
    throw apiError('请填写有效的 API Key，不能使用示例值、空格或非 ASCII 字符。');
  }
  connection.baseUrl = destinationUrl(connection.baseUrl).href.replace(/\/+$/, '');
  return connection;
}

function lookupWithSignal(hostname, lookup, signal) {
  return new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      signal?.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => finish(reject, apiError('API 请求已超时或取消。', 'timeout', 504));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    Promise.resolve().then(() => lookup(hostname, { all: true, verbatim: true })).then(
      records => finish(resolve, records),
      () => finish(reject, apiError('无法解析 API 服务地址，请检查 Base URL。', 'destination'))
    );
  });
}

export function createVisitorFetch({ lookup = resolveDns, request = httpsRequest } = {}) {
  return async function visitorFetch(endpoint, options = {}) {
    const url = destinationUrl(endpoint);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const records = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }]
      : await lookupWithSignal(hostname, lookup, options.signal);
    if (!Array.isArray(records) || records.length === 0 || records.some(record => !isPublicAddress(record?.address))) {
      throw apiError('API 服务解析到了非公网地址，无法连接。', 'destination');
    }
    if (options.signal?.aborted) throw apiError('API 请求已超时或取消。', 'timeout', 504);
    const address = records[0].address, family = isIP(address);

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = error => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      let req;
      try {
        req = request(url, {
          method: 'POST', headers: options.headers, signal: options.signal,
          agent: false, family, autoSelectFamily: false,
          // Resolve and pin for this request; HTTPS still verifies the original
          // host's certificate. No second DNS lookup or shared socket is used.
          lookup: (_host, lookupOptions, callback) => {
            if (typeof lookupOptions === 'function') callback = lookupOptions;
            if (lookupOptions?.all) callback(null, [{ address, family }]);
            else callback(null, address, family);
          }
        }, response => {
          const status = response.statusCode || 502;
          if (status >= 300 && status < 400) {
            response.destroy();
            fail(apiError('API 服务返回了重定向，请直接填写最终的 HTTPS Base URL。', 'redirect', 502));
            return;
          }
          const chunks = [];
          let size = 0;
          response.on('data', chunk => {
            size += chunk.length;
            if (size > 5 * 1024 * 1024) {
              fail(apiError('API 响应过大，请更换模型或缩小分析范围。', 'response', 502));
              response.destroy();
            } else chunks.push(chunk);
          });
          response.on('error', () => fail(apiError('读取 API 响应失败，请稍后重试。', 'network', 502)));
          response.on('aborted', () => fail(apiError('读取 API 响应失败，请稍后重试。', 'network', 502)));
          response.on('end', () => {
            if (settled) return;
            settled = true;
            const body = Buffer.concat(chunks).toString('utf8');
            resolve({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(body) });
          });
        });
        req.on('error', () => fail(options.signal?.aborted
          ? apiError('API 请求已超时或取消。', 'timeout', 504)
          : apiError('无法连接 API 服务，请检查地址后重试。', 'network', 502)));
        req.end(options.body);
      } catch {
        req?.destroy();
        fail(apiError('无法连接 API 服务，请检查地址后重试。', 'network', 502));
      }
    });
  };
}

export const visitorFetch = createVisitorFetch();
