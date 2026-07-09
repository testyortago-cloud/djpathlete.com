import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: vi.fn(async (_k: string, d: unknown) => d) }))
vi.mock("@/lib/db/ai-generation-log", () => ({ createGenerationLog: vi.fn(async () => ({ id: "log-1" })) }))
const jobSet = vi.fn(async (_doc: Record<string, unknown>) => {})
vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: () => ({ collection: () => ({ doc: () => ({ id: "job-1", set: jobSet }) }) }),
  getAdminRtdb: () => ({ ref: () => ({ set: vi.fn(async () => {}) }) }),
}))
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "ts" } }))
vi.mock("@/lib/audit/with-audit", () => ({ withAudit: (_o: unknown, h: (req: Request) => unknown) => h }))

import { POST } from "@/app/api/admin/programs/import-excel/route"
import ExcelJS from "exceljs"
// NOTE: the Vitest environment is "jsdom", which shadows the global `File`
// and `FormData` with jsdom's own implementations. Those don't survive a
// round-trip through the platform (undici-backed) `Request`/`request.formData()`
// used by Next.js route handlers — the file silently corrupts to
// name="blob", content="undefined" (verified experimentally). Building the
// multipart body from `node:buffer`'s `File` + `undici`'s `FormData` (paired
// with the ambient global `Request`, which IS undici's) round-trips
// correctly, so the test uses those instead of the bare `File`/`FormData`
// globals.
import { File as NodeFile } from "node:buffer"
import { FormData as UndiciFormData } from "undici"

async function xlsxFile(): Promise<File> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Workout")
  ws.addRow(["Week", "Day", "Exercise", "Sets", "Reps"])
  ws.addRow([1, "Monday", "Squat", 4, "6-8"])
  const buf = await wb.xlsx.writeBuffer()
  return new NodeFile([buf] as unknown as ConstructorParameters<typeof NodeFile>[0], "program.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }) as unknown as File
}
function req(file: File | null, fields: Record<string, string> = {}): Request {
  const fd = new UndiciFormData()
  if (file) fd.set("file", file as unknown as Blob)
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return new Request("http://localhost/api/admin/programs/import-excel", {
    method: "POST",
    body: fd as unknown as BodyInit,
  })
}
beforeEach(() => {
  authMock.mockReset()
  jobSet.mockClear()
})

const emptyParams = { params: Promise.resolve({}) }

describe("POST /api/admin/programs/import-excel", () => {
  it("403 when not admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await POST(req(await xlsxFile()), emptyParams)).status).toBe(403)
  })
  it("400 when file missing", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "admin" } })
    expect((await POST(req(null), emptyParams)).status).toBe(400)
  })
  it("202 and enqueues a job on the happy path", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    const res = await POST(req(await xlsxFile()), emptyParams)
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.jobId).toBe("job-1")
    expect(body.log_id).toBe("log-1")
    expect(jobSet).toHaveBeenCalledOnce()
    const jobDoc = jobSet.mock.calls[0][0] as {
      type: string
      input: { parsedSheet: { sheets: { name: string; rows: string[][] }[] } }
    }
    expect(jobDoc.type).toBe("program_from_excel")
    expect(jobDoc.input.parsedSheet.sheets[0].rows[1]).toEqual(["1", "Monday", "Squat", "4", "6-8"])
  })
})
