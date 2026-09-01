// @vitest-environment node
//
// The fault classes in lib/lead-engine/email.ts.
//
// THE DEFAULT IS "configuration", and that direction is the whole design. An
// unrecognised error costs five deferred retries (MAX_ATTEMPTS bounds it),
// while the old behaviour — every provider throw treated as terminal —
// permanently destroyed all 73 sms_repermission runs on 2026-08-31 because
// one settings field named an unverified domain.
import { describe, it, expect } from "vitest"
import { SequenceSendError, classifySendFault } from "@/lib/lead-engine/email"

describe("classifySendFault", () => {
  it("calls the unverified-domain rejection a configuration fault", () => {
    // Verbatim from production, 2026-08-31 12:00:10Z.
    const err = new SequenceSendError(
      "sendSequenceEmail failed: The darrenjpaul.com domain is not verified. Please, add and verify your domain on https://resend.com/domains",
      { providerErrorName: "validation_error", statusCode: 403 },
    )
    expect(classifySendFault(err)).toBe("configuration")
  })

  it("calls a named bad recipient a recipient fault", () => {
    const err = new SequenceSendError("sendSequenceEmail failed: Invalid `to` field.", {
      providerErrorName: "invalid_to_address",
      statusCode: 422,
    })
    expect(classifySendFault(err)).toBe("recipient")
  })

  it("defaults an unrecognised error to configuration", () => {
    expect(classifySendFault(new Error("something nobody has seen before"))).toBe("configuration")
  })

  it("treats a rate limit as configuration, not as the recipient's fault", () => {
    const err = new SequenceSendError("sendSequenceEmail failed: Too many requests.", {
      providerErrorName: "rate_limit_exceeded",
      statusCode: 429,
    })
    expect(classifySendFault(err)).toBe("configuration")
  })

  it("reads a 422 that names the FROM address as configuration, not recipient", () => {
    // 422 alone is not enough. The status says "we refused this value"; only
    // the message says which value, and a refused sender is the operator's
    // problem, not this contact's.
    const err = new SequenceSendError("sendSequenceEmail failed: The `from` address is not permitted.", {
      providerErrorName: "validation_error",
      statusCode: 422,
    })
    expect(classifySendFault(err)).toBe("configuration")
  })
})

describe("SequenceSendError", () => {
  it("keeps the message format callers already match on", () => {
    // `last_error` strings already in the database start with this prefix,
    // and so do the assertions in the route-level suite.
    const err = new SequenceSendError("sendSequenceEmail failed: boom", {
      providerErrorName: null,
      statusCode: null,
    })
    expect(err.message).toBe("sendSequenceEmail failed: boom")
    expect(err).toBeInstanceOf(Error)
  })
})
