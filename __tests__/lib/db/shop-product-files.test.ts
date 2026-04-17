import { describe, expect, it, beforeAll } from "vitest"
import {
  attachFileToProduct,
  listFilesForProduct,
  deleteProductFile,
} from "@/lib/db/shop-product-files"
import { createServiceRoleClient } from "@/lib/supabase"

describe("shop-product-files DAL", () => {
  let productId: string

  beforeAll(async () => {
    const supabase = createServiceRoleClient()
    const { data } = await supabase
      .from("shop_products")
      .insert({
        slug: `digi-${Date.now()}`,
        name: "digital test",
        description: "",
        thumbnail_url: "https://x/i.jpg",
        product_type: "digital",
      })
      .select("id")
      .single()
    productId = data!.id
  })

  it("attaches + lists + deletes a file", async () => {
    const file = await attachFileToProduct({
      product_id: productId,
      file_name: "x.pdf",
      display_name: "X",
      storage_path: "downloads/x.pdf",
      file_size_bytes: 1234,
      mime_type: "application/pdf",
    })
    expect(file.id).toBeTruthy()

    const list = await listFilesForProduct(productId)
    expect(list.some((f) => f.id === file.id)).toBe(true)

    await deleteProductFile(file.id)
    const after = await listFilesForProduct(productId)
    expect(after.some((f) => f.id === file.id)).toBe(false)
  })
})
