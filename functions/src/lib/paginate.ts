// Twin of lib/db/paginate.ts's fetchAllRows (functions/ cannot import lib/),
// with one addition for chat tools: a REQUIRED maxRows hard stop, because a
// tool result feeds straight back into the model — it must never balloon and
// must never silently truncate (D-11: partial is explicit, never implied).
// MUST import nothing: the root-side parity/consumer tests relative-import
// sibling files in this directory across the package boundary.

const DEFAULT_PAGE_SIZE = 1000

export interface FetchAllResult<T> {
  rows: T[]
  partial: boolean
}

export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  maxRows: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<FetchAllResult<T>> {
  const all: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await buildQuery(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const batch = data ?? []
    all.push(...batch)
    const exhausted = batch.length < pageSize
    // Overshoot (a short final page may land past the cap): keep the first maxRows.
    if (all.length > maxRows) return { rows: all.slice(0, maxRows), partial: true }
    // Landed exactly on the cap off a FULL page: completeness unprovable without
    // another fetch — report the cap honestly rather than probe.
    if (all.length === maxRows && !exhausted) return { rows: all, partial: true }
    if (exhausted) return { rows: all, partial: false }
    from += pageSize
  }
}
