export async function withRetry(task, options = {}) {
  const retries = options.retries ?? 2;
  const delayMs = options.delayMs ?? 1000;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === retries || (options.shouldRetry && !options.shouldRetry(error))) {
        break;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, delayMs * (attempt + 1));
      });
    }
  }

  throw lastError;
}
