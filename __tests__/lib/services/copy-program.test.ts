// __tests__/lib/services/copy-program.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const getProgramById = vi.fn()
const createProgram = vi.fn()
const deleteProgram = vi.fn()
vi.mock("@/lib/db/programs", () => ({
  getProgramById: (...a: unknown[]) => getProgramById(...a),
  createProgram: (...a: unknown[]) => createProgram(...a),
  deleteProgram: (...a: unknown[]) => deleteProgram(...a),
}))

type Row = Record<string, unknown>
let fake: ReturnType<typeof makeFake>
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => fake.client }))

/**
 * A PostgREST stand-in that ENFORCES the 1000-row cap: a read without .range()
 * would silently stop at 1000, exactly as production does.
 */
function makeFake(exercises: Row[], pricing: Row[], opts: { failInsertCall?: number } = {}) {
  const inserted: { table: string; rows: Row[] }[] = []
  let insertCalls = 0
  const client = {
    from(table: string) {
      return {
        select() {
          const filters: [string, unknown][] = []
          let range: [number, number] | null = null
          const q = {
            eq(col: string, v: unknown) {
              filters.push([col, v])
              return q
            },
            order() {
              return q
            },
            range(a: number, b: number) {
              range = [a, b]
              return q
            },
            then(resolve: (r: { data: Row[]; error: null }) => void) {
              const src = table === "program_exercises" ? exercises : pricing
              let rows = src.filter((r) => filters.every(([c, v]) => r[c] === v))
              if (range) rows = rows.slice(range[0], range[1] + 1)
              resolve({ data: rows.slice(0, 1000), error: null })
            },
          }
          return q
        },
        insert(rows: Row[]) {
          insertCalls++
          if (opts.failInsertCall === insertCalls) {
            return Promise.resolve({ error: { code: "XX000", message: "insert failed" } })
          }
          inserted.push({ table, rows })
          return Promise.resolve({ error: null })
        },
      }
    },
  }
  return { client, inserted }
}

import { copyProgram } from "@/lib/services/copy-program"

const SOURCE = {
  id: "src-1",
  name: "12-Week Strength",
  description: null,
  stripe_product_id: "prod_src",
  stripe_price_id: "price_src",
  is_template: true,
  folder_id: "folder-1",
  is_public: false,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
}

function exerciseRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `pe-${i}`,
    program_id: "src-1",
    exercise_id: `ex-${i % 7}`,
    week_number: Math.floor(i / 200) + 1,
    day_of_week: (i % 5) + 1,
    order_index: i,
    slot_role: i % 2 ? "accessory" : "primary_compound",
    future_column: `kept-${i}`,
    created_at: "2026-01-01",
  }))
}

beforeEach(() => {
  getProgramById.mockReset().mockResolvedValue(SOURCE)
  createProgram.mockReset().mockResolvedValue({ ...SOURCE, id: "copy-1" })
  deleteProgram.mockReset().mockResolvedValue(undefined)
})

describe("copyProgram", () => {
  it("copies 2,300 exercises across three pages, every column but the row's own identity", async () => {
    fake = makeFake(exerciseRows(2300), [])
    await copyProgram("src-1", { name: "Copy" })
    const rows = fake.inserted.filter((i) => i.table === "program_exercises").flatMap((i) => i.rows)
    expect(rows).toHaveLength(2300)
    expect(rows[1999]).toMatchObject({ program_id: "copy-1", slot_role: "accessory", future_column: "kept-1999" })
    expect(rows[0]).not.toHaveProperty("id")
    expect(rows[0]).not.toHaveProperty("created_at")
  })

  it("nulls Stripe ids and applies the overrides on the new row", async () => {
    fake = makeFake([], [])
    await copyProgram("src-1", { is_template: false, folder_id: null, is_public: false, name: "Jo's copy" })
    const payload = createProgram.mock.calls[0][0]
    expect(payload).toMatchObject({
      stripe_product_id: null,
      stripe_price_id: null,
      is_template: false,
      folder_id: null,
      name: "Jo's copy",
    })
    expect(payload).not.toHaveProperty("id")
  })

  it("copies premium-week pricing onto the new program", async () => {
    fake = makeFake([], [{ program_id: "src-1", week_number: 5, price_cents: 4000 }])
    await copyProgram("src-1", {})
    const pricing = fake.inserted.find((i) => i.table === "program_week_pricing")!.rows
    expect(pricing).toEqual([{ program_id: "copy-1", week_number: 5, price_cents: 4000 }])
  })

  it("deletes the half-built copy and rethrows when an insert fails", async () => {
    fake = makeFake(exerciseRows(10), [], { failInsertCall: 1 })
    await expect(copyProgram("src-1", {})).rejects.toBeTruthy()
    expect(deleteProgram).toHaveBeenCalledWith("copy-1")
  })

  it("an empty program copies with no exercise insert (presence control)", async () => {
    fake = makeFake([], [])
    const copy = await copyProgram("src-1", {})
    expect(copy.id).toBe("copy-1")
    expect(fake.inserted).toEqual([])
    expect(deleteProgram).not.toHaveBeenCalled()
  })
})
