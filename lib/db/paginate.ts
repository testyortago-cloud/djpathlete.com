// lib/db/paginate.ts
// Defeats PostgREST's silent ~1000-row cap by paging .range() windows until a
// short page. Promoted from lib/db/newsletter.ts's private fetchAllRows so the
// whole app shares one correct paginator. Pass a builder that applies your
// filters/order and returns .range(from, to).

const DEFAULT_PAGE_SIZE = 1000

export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  for (;;) {
    const to = from + pageSize - 1
    const { data, error } = await buildQuery(from, to)
    if (error) throw new Error(error.message)
    const batch = data ?? []
    all.push(...batch)
    if (batch.length < pageSize) break
    from += pageSize
  }
  return all
}
