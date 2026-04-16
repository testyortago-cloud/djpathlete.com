import { randomBytes } from "node:crypto"

// Crockford-like alphabet: no 0/O/1/I/L to avoid ambiguity
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

export function generateOrderNumber(): string {
  const bytes = randomBytes(8)
  let s = ""
  for (let i = 0; i < 8; i++) {
    s += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return `DJP-${s}`
}
