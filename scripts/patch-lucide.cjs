/**
 * Patches lucide-react to fix the deprecated Twitter icon that
 * crashes Turbopack HMR in Next.js 16.
 *
 * 1. Strips Twitter re-exports from barrel files.
 * 2. Replaces icons/twitter.js with a safe re-export of icons/x.js
 *    so Turbopack never encounters a broken module factory.
 */
const fs = require("fs")
const path = require("path")

// --- Step 1: strip Twitter from barrel files ---
const barrels = [
  "node_modules/lucide-react/dist/esm/lucide-react.js",
  "node_modules/lucide-react/dist/esm/icons/index.js",
  "node_modules/lucide-react/dist/cjs/lucide-react.js",
]

for (const file of barrels) {
  const fullPath = path.resolve(__dirname, "..", file)
  if (!fs.existsSync(fullPath)) continue

  let content = fs.readFileSync(fullPath, "utf8")
  const before = content.length

  content = content
    .split("\n")
    .filter((line) => !line.toLowerCase().includes("twitter"))
    .join("\n")

  if (content.length !== before) {
    fs.writeFileSync(fullPath, content)
    console.log(`[patch-lucide] Stripped Twitter from ${file}`)
  }
}

// --- Step 2: replace the standalone twitter.js icon file ---
const twitterEsm = path.resolve(__dirname, "..", "node_modules/lucide-react/dist/esm/icons/twitter.js")

if (fs.existsSync(twitterEsm)) {
  const safeContent = [
    "/**",
    " * @license lucide-react - ISC",
    " * Patched: re-exports X icon to prevent Turbopack HMR crash.",
    " */",
    "export { default, __iconNode } from './x.js';",
    "",
  ].join("\n")

  fs.writeFileSync(twitterEsm, safeContent)
  console.log("[patch-lucide] Replaced icons/twitter.js with safe re-export")
}

const twitterCjs = path.resolve(__dirname, "..", "node_modules/lucide-react/dist/cjs/icons/twitter.js")

if (fs.existsSync(twitterCjs)) {
  const safeContent = [
    "/**",
    " * @license lucide-react - ISC",
    " * Patched: re-exports X icon to prevent Turbopack HMR crash.",
    " */",
    'const x = require("./x.js");',
    "module.exports = x;",
    "",
  ].join("\n")

  fs.writeFileSync(twitterCjs, safeContent)
  console.log("[patch-lucide] Replaced CJS icons/twitter.js with safe re-export")
}
