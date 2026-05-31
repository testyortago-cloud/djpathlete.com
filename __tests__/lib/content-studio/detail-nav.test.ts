import { describe, it, expect } from "vitest"
import { detailBackInfo } from "@/lib/content-studio/detail-nav"

describe("detailBackInfo", () => {
  it("maps known shell tabs to a labeled href", () => {
    expect(detailBackInfo("videos")).toEqual({ href: "/admin/content?tab=videos", label: "Videos" })
    expect(detailBackInfo("posts")).toEqual({ href: "/admin/content?tab=posts", label: "Posts" })
    expect(detailBackInfo("calendar")).toEqual({ href: "/admin/content?tab=calendar", label: "Calendar" })
  })
  it("defaults to the Pipeline tab for undefined or unknown tabs", () => {
    expect(detailBackInfo(undefined)).toEqual({ href: "/admin/content", label: "Pipeline" })
    expect(detailBackInfo("bogus")).toEqual({ href: "/admin/content", label: "Pipeline" })
  })
})
