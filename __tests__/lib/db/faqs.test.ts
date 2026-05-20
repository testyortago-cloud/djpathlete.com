import { describe, it, expect, vi, beforeEach } from "vitest"

const fromMock = vi.fn()
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: fromMock }),
}))

import {
  listFaqsForPage,
  createFaq,
  updateFaq,
  deleteFaq,
  reorderFaqs,
} from "@/lib/db/faqs"
import type { FaqInput } from "@/lib/validators/faq"

function chainable(data: unknown, error: unknown = null) {
  const chain: any = {}
  const methods = ["select", "eq", "order", "insert", "update", "delete", "single"]
  methods.forEach((m) => {
    chain[m] = vi.fn(() => chain)
  })
  chain.then = (resolve: (v: unknown) => void) => resolve({ data, error })
  chain.single = vi.fn().mockResolvedValue({ data, error })
  return chain
}

beforeEach(() => {
  fromMock.mockReset()
})

const baseInput: FaqInput = {
  page_key: "online",
  category: null,
  question: "Q",
  answer: "A",
  link_text: null,
  link_href: null,
  status: "published",
}

describe("listFaqsForPage", () => {
  it("queries published FAQs for a page ordered by sort_order", async () => {
    const chain = chainable([
      { id: "1", page_key: "online", question: "Q", answer: "A", sort_order: 0 },
    ])
    fromMock.mockReturnValueOnce(chain)

    const rows = await listFaqsForPage("online", { publishedOnly: true })
    expect(rows).toHaveLength(1)
    expect(fromMock).toHaveBeenCalledWith("faqs")
    expect(chain.eq).toHaveBeenCalledWith("page_key", "online")
    expect(chain.eq).toHaveBeenCalledWith("status", "published")
    expect(chain.order).toHaveBeenCalledWith("sort_order", { ascending: true })
  })

  it("omits the status filter when publishedOnly is not set", async () => {
    const chain = chainable([])
    fromMock.mockReturnValueOnce(chain)

    await listFaqsForPage("online")
    expect(chain.eq).toHaveBeenCalledWith("page_key", "online")
    expect(chain.eq).not.toHaveBeenCalledWith("status", "published")
  })

  it("throws on query error", async () => {
    fromMock.mockReturnValueOnce(chainable(null, { message: "boom" }))
    await expect(listFaqsForPage("online")).rejects.toThrow("boom")
  })
})

describe("createFaq", () => {
  it("assigns sort_order to the end of the page list", async () => {
    // listFaqsForPage call inside createFaq returns 2 existing rows
    fromMock.mockReturnValueOnce(chainable([{ id: "a" }, { id: "b" }]))
    const insertChain = chainable({ ...baseInput, id: "new", sort_order: 2 })
    fromMock.mockReturnValueOnce(insertChain)

    const result = await createFaq(baseInput)
    expect(result.id).toBe("new")
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ sort_order: 2, page_key: "online" }),
    )
  })

  it("throws on insert error", async () => {
    fromMock.mockReturnValueOnce(chainable([]))
    fromMock.mockReturnValueOnce(chainable(null, { message: "fail" }))
    await expect(createFaq(baseInput)).rejects.toThrow("fail")
  })
})

describe("updateFaq", () => {
  it("updates by id and returns the row", async () => {
    const chain = chainable({ ...baseInput, id: "x", sort_order: 0 })
    fromMock.mockReturnValueOnce(chain)

    const result = await updateFaq("x", baseInput)
    expect(result.id).toBe("x")
    expect(chain.update).toHaveBeenCalledWith(baseInput)
    expect(chain.eq).toHaveBeenCalledWith("id", "x")
  })
})

describe("deleteFaq", () => {
  it("deletes by id", async () => {
    const chain = chainable(null)
    fromMock.mockReturnValueOnce(chain)

    await deleteFaq("x")
    expect(chain.delete).toHaveBeenCalled()
    expect(chain.eq).toHaveBeenCalledWith("id", "x")
  })

  it("throws on delete error", async () => {
    fromMock.mockReturnValueOnce(chainable(null, { message: "nope" }))
    await expect(deleteFaq("x")).rejects.toThrow("nope")
  })
})

describe("reorderFaqs", () => {
  it("persists sort_order per id by index", async () => {
    const c0 = chainable(null)
    const c1 = chainable(null)
    const c2 = chainable(null)
    fromMock
      .mockReturnValueOnce(c0)
      .mockReturnValueOnce(c1)
      .mockReturnValueOnce(c2)

    await reorderFaqs(["a", "b", "c"])
    expect(c0.update).toHaveBeenCalledWith({ sort_order: 0 })
    expect(c0.eq).toHaveBeenCalledWith("id", "a")
    expect(c1.update).toHaveBeenCalledWith({ sort_order: 1 })
    expect(c1.eq).toHaveBeenCalledWith("id", "b")
    expect(c2.update).toHaveBeenCalledWith({ sort_order: 2 })
    expect(c2.eq).toHaveBeenCalledWith("id", "c")
  })
})
