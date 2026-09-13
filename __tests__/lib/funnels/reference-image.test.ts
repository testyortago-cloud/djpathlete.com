// The browser-side downscale (2026-09-14 spec §5).
//
// `scaledDimensions` and `referenceImageRejection` are split out as pure
// functions precisely so the ARITHMETIC and the GATE can be tested without a
// canvas — jsdom has no real 2D context, so a test that went through
// `prepareReferenceImage` could only ever assert that a stub was called.
import { describe, it, expect } from "vitest"
import { scaledDimensions, referenceImageRejection } from "@/lib/funnels/reference-image"
import {
  BUILDER_REFERENCE_IMAGE_MAX_EDGE,
  BUILDER_REFERENCE_IMAGE_MAX_SOURCE_BYTES,
} from "@/lib/funnels/sections/builder-config"

describe("scaledDimensions", () => {
  it("leaves an image already inside the bound completely alone", () => {
    // Not merely "small enough" — the EXACT same numbers back. Re-encoding a
    // small PNG costs quality for nothing.
    expect(scaledDimensions(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it("leaves an image sitting exactly on the bound alone", () => {
    const e = BUILDER_REFERENCE_IMAGE_MAX_EDGE
    expect(scaledDimensions(e, 400)).toEqual({ width: e, height: 400 })
  })

  it("scales a landscape image by its WIDTH and keeps the aspect ratio", () => {
    // 3840x2160 -> 1568 wide. 2160 * (1568/3840) = 882.
    expect(scaledDimensions(3840, 2160)).toEqual({ width: 1568, height: 882 })
  })

  it("scales a PORTRAIT image by its HEIGHT, not its width", () => {
    // The mutant: scaling on `width` unconditionally, which leaves a tall
    // screenshot far over the bound on its long edge — the exact case a phone
    // screenshot or a full-page capture produces.
    expect(scaledDimensions(1080, 3840)).toEqual({ width: 441, height: 1568 })
  })

  it("never produces a zero dimension for an extreme aspect ratio", () => {
    // 20000x3 would round to height 0 and `drawImage` would throw.
    const { width, height } = scaledDimensions(20000, 3)
    expect(width).toBe(1568)
    expect(height).toBeGreaterThanOrEqual(1)
  })
})

describe("referenceImageRejection", () => {
  it("passes a normal screenshot", () => {
    expect(referenceImageRejection({ type: "image/png", size: 400_000 })).toBeNull()
  })

  it("rejects a type the model cannot read, naming what IS accepted", () => {
    const message = referenceImageRejection({ type: "image/avif", size: 1000 })
    expect(message).toBeTruthy()
    // The owner must be told what to do, not merely that they were wrong.
    expect(message).toMatch(/JPEG|PNG/i)
  })

  it("rejects a non-image outright", () => {
    expect(referenceImageRejection({ type: "application/pdf", size: 1000 })).toBeTruthy()
  })

  it("rejects a file over the source bound BEFORE any decoding", () => {
    const message = referenceImageRejection({
      type: "image/png",
      size: BUILDER_REFERENCE_IMAGE_MAX_SOURCE_BYTES + 1,
    })
    expect(message).toBeTruthy()
  })

  it("accepts a file sitting exactly on the source bound", () => {
    // The bound is probed at its edge in both directions, so an off-by-one
    // that rejects a legal file is visible.
    expect(
      referenceImageRejection({ type: "image/png", size: BUILDER_REFERENCE_IMAGE_MAX_SOURCE_BYTES }),
    ).toBeNull()
  })
})
