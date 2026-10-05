import { describe, it, expect, vi, beforeEach } from "vitest"

const calls: { table: string; op: string; args: unknown[] }[] = []
function builder(table: string, data: unknown[]) {
  const b: Record<string, unknown> = {}
  for (const op of ["select", "eq", "not", "in", "is", "order"]) {
    b[op] = (...args: unknown[]) => {
      calls.push({ table, op, args })
      return b
    }
  }
  b.then = (resolve: (r: unknown) => void) => resolve({ data, error: null })
  return b
}
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (t: string) => builder(t, t === "program_folders" ? [{ id: "f1" }, { id: "f2" }] : []),
  }),
}))

import { getPrograms, getLibraryPrograms } from "@/lib/db/programs"
import { listGrantablePrograms } from "@/lib/db/pipeline"

const eqs = (table: string) => calls.filter((c) => c.table === table && c.op === "eq").map((c) => c.args)

beforeEach(() => {
  calls.length = 0
})

describe("readers that must never offer a library program", () => {
  it("getPrograms filters is_template = false", async () => {
    await getPrograms()
    expect(eqs("programs")).toContainEqual(["is_template", false])
  })
  it("listGrantablePrograms filters is_template = false", async () => {
    await listGrantablePrograms()
    expect(eqs("programs")).toContainEqual(["is_template", false])
  })
})

describe("getLibraryPrograms", () => {
  it("reads only this business's folders, then templates inside them", async () => {
    await getLibraryPrograms("biz-1")
    expect(eqs("program_folders")).toContainEqual(["business_id", "biz-1"])
    expect(eqs("programs")).toContainEqual(["is_template", true])
    expect(calls.find((c) => c.table === "programs" && c.op === "in")?.args).toEqual(["folder_id", ["f1", "f2"]])
  })
})
