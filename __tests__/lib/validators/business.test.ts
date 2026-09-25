// @vitest-environment node
// G33: business_settings.sms_sender_phone is matched VERBATIM against the `To`
// field Twilio posts on every inbound text (getBusinessBySmsNumber), and Twilio
// always posts E.164. It is also the `From` of every outbound text when the
// business has no Messaging Service. So a number saved as "(202) 555-0123"
// never matches an inbound text and cannot send one, and nothing says so.
//
// Every "valid" fixture below was checked against libphonenumber-js before it
// was used. Several numbers this repo's fakes use (+15550001111,
// +15550101234) are NOT valid numbers to it, so they cannot stand in here.
import { describe, it, expect } from "vitest"
import {
  businessSettingsPatchSchema,
  SMS_SENDER_PHONE_NEEDS_COUNTRY_CODE,
  SMS_SENDER_PHONE_NOT_A_NUMBER,
} from "@/lib/validators/business"

function parsePhone(raw: string) {
  return businessSettingsPatchSchema.safeParse({ sms_sender_phone: raw })
}

function savedAs(raw: string): string | undefined {
  const result = parsePhone(raw)
  if (!result.success) throw new Error(`expected ${JSON.stringify(raw)} to parse: ${result.error.issues[0]?.message}`)
  return result.data.sms_sender_phone
}

function refusalFor(raw: string): string {
  const result = parsePhone(raw)
  if (result.success)
    throw new Error(`expected ${JSON.stringify(raw)} to be refused, got ${JSON.stringify(result.data)}`)
  expect(result.error.issues).toHaveLength(1)
  expect(result.error.issues[0].path).toEqual(["sms_sender_phone"])
  return result.error.issues[0].message
}

describe("businessSettingsPatchSchema -- sms_sender_phone", () => {
  describe("national format is refused, and the coach is told to add the country code", () => {
    // Decision taken for G33: require the country code rather than assume the
    // US. Guessing would "work" for a US coach and mis-file anyone else: read
    // with a default country of US, Mexico City's "55 1234 5678" is a VALID
    // US number, +15512345678 (checked against libphonenumber).
    it.each([
      ["(202) 555-0123"],
      ["202-555-0123"],
      ["2025550123"],
      ["1 202 555 0123"],
      ["55 1234 5678"],
      ["020 7946 0958"],
      ["00 44 20 7946 0958"],
    ])("refuses %j", (raw) => {
      // The EXACT message. The not-a-number message also mentions "+", the
      // country code and Twilio, so a looser match passed with either one.
      expect(refusalFor(raw)).toBe(SMS_SENDER_PHONE_NEEDS_COUNTRY_CODE)
    })
  })

  describe("a number with its country code is saved in E.164", () => {
    it.each([
      ["+1 (202) 555-0123", "+12025550123"],
      ["+1 202 555 0123", "+12025550123"],
      ["+1-202-555-0123", "+12025550123"],
      ["+1.202.555.0123", "+12025550123"],
      ["  +1 202 555 0123  ", "+12025550123"],
      ["+15005550006", "+15005550006"],
    ])("%j -> %j", (raw, e164) => {
      expect(savedAs(raw)).toBe(e164)
    })

    it.each([
      ["+44 20 7946 0958", "+442079460958"],
      ["+63 917 123 4567", "+639171234567"],
      ["+61 491 570 156", "+61491570156"],
      ["+52 55 1234 5678", "+525512345678"],
    ])("a non-US number: %j -> %j", (raw, e164) => {
      expect(savedAs(raw)).toBe(e164)
    })

    // The form validates with this schema through zodResolver and submits
    // the TRANSFORMED value; the route then parses the body with the same
    // schema again. The second pass sees E.164 and must hand it back as is.
    it.each([["+12025550123"], ["+442079460958"], ["+639171234567"]])("is idempotent on E.164 input: %j", (e164) => {
      expect(savedAs(e164)).toBe(e164)
      expect(savedAs(savedAs(e164) as string)).toBe(e164)
    })
  })

  describe("an empty value means 'not configured' and is kept", () => {
    it("accepts '' as ''", () => {
      expect(savedAs("")).toBe("")
    })

    it("treats whitespace alone as ''", () => {
      expect(savedAs("   ")).toBe("")
    })

    it("leaves the field out of the patch when it was not sent at all", () => {
      // A patch that does not name the field must not blank the saved number.
      const result = businessSettingsPatchSchema.safeParse({ display_name: "DJP Athlete" })
      expect(result.success).toBe(true)
      expect(result.success && "sms_sender_phone" in result.data).toBe(false)
    })
  })

  describe("anything that is not a phone number is refused", () => {
    it.each([
      ["+"],
      ["+abc"],
      ["hello"],
      ["+1 555 010 0123"],
      ["+1202555012"],
      ["+120255501234"],
      // libphonenumber reads a number out of surrounding text and drops an
      // extension without a word, so these parse as +12025550123 unless the
      // characters are checked first. A sender number has no extension.
      ["+1 202 555 0123 abc"],
      ["+1 202 555 0123 ext. 5"],
      ["+1 202 555 0123x5"],
      ["tel:+12025550123"],
      // A trailing ZERO-WIDTH SPACE, written as an escape so it can be seen.
      [`+1 202 555 0123${String.fromCharCode(0x200b)}`],
      // A "+" is allowed once, at the start. libphonenumber itself accepts a
      // trailing one as +12025550123.
      ["+12025550123+"],
      ["+1 202 +555 0123"],
    ])("refuses %j", (raw) => {
      expect(refusalFor(raw)).toBe(SMS_SENDER_PHONE_NOT_A_NUMBER)
    })

    // The FULLWIDTH PLUS (U+FF0B) is refused even though libphonenumber lists
    // it as a plus sign: it does not treat it as "international" and falls back
    // to the US default, so this Singapore number would otherwise be saved as
    // +16581234567, a valid JAMAICAN number (checked against libphonenumber).
    it("refuses a fullwidth plus rather than filing the number under +1", () => {
      expect(refusalFor(`${String.fromCharCode(0xff0b)}65 8123 4567`)).toBe(SMS_SENDER_PHONE_NOT_A_NUMBER)
    })
  })

  describe("digits typed on a non-Latin keyboard are read, and saved as ASCII E.164", () => {
    // libphonenumber reads these four digit sets. Refusing them told a coach on
    // a Japanese (full-width) or Arabic keyboard that a correct number was
    // "not a phone number". Built from code points so the fixtures are legible.
    const digits = (zero: number) =>
      "12025550123"
        .split("")
        .map((d) => String.fromCharCode(zero + Number(d)))
        .join("")

    it.each([
      ["fullwidth", 0xff10],
      ["Arabic-Indic", 0x0660],
      ["Persian", 0x06f0],
    ])("%s digits after an ASCII +", (_script, zero) => {
      expect(savedAs(`+${digits(zero)}`)).toBe("+12025550123")
    })

    it("still requires the ASCII + : a national number in fullwidth digits gets the country-code message", () => {
      expect(refusalFor(digits(0xff10).slice(1))).toBe(SMS_SENDER_PHONE_NEEDS_COUNTRY_CODE)
    })
  })
})
