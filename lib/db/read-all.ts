const PAGE = 1000

/**
 * Every row of a query, not just the first 1000: PostgREST stops there without saying so.
 * `page(from, to)` must select with `{ count: "exact" }` and order on a unique column, or
 * rows can repeat or go missing between pages. The pages after the first run in parallel.
 */
export async function readAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown; count: number | null }>,
): Promise<T[]> {
  const first = await page(0, PAGE - 1)
  if (first.error) throw first.error
  if (first.count == null) throw new Error("readAllRows: the query must select with { count: 'exact' }")
  const rest: PromiseLike<{ data: T[] | null; error: unknown }>[] = []
  for (let from = PAGE; from < first.count; from += PAGE) rest.push(page(from, from + PAGE - 1))
  const rows = [...(first.data ?? [])]
  for (const { data, error } of await Promise.all(rest)) {
    if (error) throw error
    rows.push(...(data ?? []))
  }
  return rows
}
