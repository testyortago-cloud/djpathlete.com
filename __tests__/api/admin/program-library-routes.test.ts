// @vitest-environment node
// __tests__/api/admin/program-library-routes.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const { NoAccessibleBusinessError } = vi.hoisted(() => {
  class NoAccessibleBusinessError extends Error {}
  return { NoAccessibleBusinessError }
})

const resolveTenant = vi.fn()
const folders = {
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
}
const getProgramById = vi.fn()
const updateProgram = vi.fn()
const copyProgram = vi.fn()

vi.mock("@/lib/audit/with-audit", () => ({ withAudit: (_o: unknown, h: unknown) => h }))
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenantForRequest: (...a: unknown[]) => resolveTenant(...a),
  NoAccessibleBusinessError,
}))
vi.mock("@/lib/db/program-folders", () => ({
  listProgramFolders: (...a: unknown[]) => folders.list(...a),
  getProgramFolder: (...a: unknown[]) => folders.get(...a),
  createProgramFolder: (...a: unknown[]) => folders.create(...a),
  renameProgramFolder: (...a: unknown[]) => folders.rename(...a),
  deleteProgramFolder: (...a: unknown[]) => folders.remove(...a),
  pgErrorCode: (e: unknown) => (e as { code?: string })?.code,
}))
vi.mock("@/lib/db/programs", () => ({
  getProgramById: (...a: unknown[]) => getProgramById(...a),
  updateProgram: (...a: unknown[]) => updateProgram(...a),
}))
vi.mock("@/lib/services/copy-program", () => ({ copyProgram: (...a: unknown[]) => copyProgram(...a) }))

import { POST as createFolder } from "@/app/api/admin/programs/folders/route"
import { DELETE as deleteFolder } from "@/app/api/admin/programs/folders/[folderId]/route"
import { POST as saveToLibrary } from "@/app/api/admin/programs/[id]/save-to-library/route"
import { PATCH as moveProgram } from "@/app/api/admin/programs/[id]/folder/route"

const FOLDER = "33333333-3333-4333-8333-333333333333"
const json = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) })
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) })

beforeEach(() => {
  resolveTenant.mockReset().mockResolvedValue({ businessId: "biz-1" })
  Object.values(folders).forEach((f) => f.mockReset())
  getProgramById.mockReset()
  updateProgram.mockReset()
  copyProgram.mockReset()
})

describe("folders", () => {
  it("creates a folder in the caller's own business", async () => {
    folders.create.mockResolvedValue({ id: FOLDER, name: "Strength" })
    const res = await createFolder(json({ name: " Strength " }), ctx({}))
    expect(res.status).toBe(201)
    expect(folders.create).toHaveBeenCalledWith("biz-1", "Strength")
  })

  it("answers 409 with a plain sentence for a duplicate name", async () => {
    folders.create.mockRejectedValue({ code: "23505" })
    const res = await createFolder(json({ name: "Strength" }), ctx({}))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already have a folder/i)
  })

  it("refuses to delete a folder that still holds programs, with a plain sentence", async () => {
    folders.remove.mockRejectedValue({ code: "23503" })
    const res = await deleteFolder(new Request("http://localhost/x", { method: "DELETE" }), ctx({ folderId: FOLDER }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/move or delete/i)
  })

  it("deletes an empty folder (presence control)", async () => {
    folders.remove.mockResolvedValue(true)
    const res = await deleteFolder(new Request("http://localhost/x", { method: "DELETE" }), ctx({ folderId: FOLDER }))
    expect(res.status).toBe(200)
    expect(folders.remove).toHaveBeenCalledWith("biz-1", FOLDER)
  })
})

describe("save to library", () => {
  it("404s a folder from another business and copies nothing", async () => {
    folders.get.mockResolvedValue(null)
    const res = await saveToLibrary(json({ folder_id: FOLDER }), ctx({ id: "p1" }))
    expect(res.status).toBe(404)
    expect(copyProgram).not.toHaveBeenCalled()
  })

  it("copies the program into the folder as a private library program", async () => {
    folders.get.mockResolvedValue({ id: FOLDER })
    getProgramById.mockResolvedValue({ id: "p1", name: "Block A" })
    copyProgram.mockResolvedValue({ id: "copy-1" })
    const res = await saveToLibrary(json({ folder_id: FOLDER }), ctx({ id: "p1" }))
    expect(res.status).toBe(201)
    expect(copyProgram).toHaveBeenCalledWith("p1", { is_template: true, folder_id: FOLDER, is_public: false, name: "Block A" })
  })
})

describe("move to folder", () => {
  it("refuses a program that is not in the library", async () => {
    getProgramById.mockResolvedValue({ id: "p1", is_template: false, folder_id: null })
    const res = await moveProgram(json({ folder_id: FOLDER }), ctx({ id: "p1" }))
    expect(res.status).toBe(400)
    expect(updateProgram).not.toHaveBeenCalled()
  })
})
