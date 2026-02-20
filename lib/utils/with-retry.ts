/**
 * Generic retry wrapper with exponential back-off (1 s, 2 s, 4 s, ...).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = 3
): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      // Only wait if there are remaining attempts
      if (attempt < retries - 1) {
        const delay = Math.pow(2, attempt) * 1000 // 1s, 2s, 4s
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError
}
