/**
 * Every row a query matches, not just the first 1,000.
 *
 * PostgREST hands back at most `max-rows` (1,000 on this project) per request, and
 * `.limit(50000)` cannot lift that cap: the dashboard summed 1,000 of 1,461 gate sales
 * on event day and revenue "dropped". So this pages with `.range()` until a short page.
 *
 * `page` must sort on something unique (end with `.order("id")`), or rows that tie
 * can repeat or go missing between pages.
 *
 * A failed page stops the loop and returns what came back so far, the way the callers
 * already treat `data ?? []`: the gate desk keeps selling even if a total is short.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  size = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) {
      console.error(`fetchAll: page at ${from} failed: ${error.message}`);
      return rows;
    }
    rows.push(...(data ?? []));
    if (!data || data.length < size) return rows;
  }
}
