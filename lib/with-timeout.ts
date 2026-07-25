/** Bounded-promise race, promoted VERBATIM from app/api/inquiry/route.ts:15-25
 *  (5b narrative tail). The inquiry route keeps its private copy — touching it
 *  is out of scope for Track B. clearTimeout in finally: no dangling timers. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer!)
  }
}
