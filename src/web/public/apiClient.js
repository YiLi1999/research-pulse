export function usesBrowserRuntime() {
  return typeof document !== 'undefined' && document.querySelector('meta[name="rp-runtime"]')?.content === 'vercel';
}

export async function apiFetch(input, options) {
  if (usesBrowserRuntime()) return (await import('/visitorClient.js')).apiFetch(input, options);
  return fetch(input, options);
}
