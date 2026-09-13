// Shared chromium launcher.
//
// `chromium.launch()` fails on this machine when the full browser build is not
// installed but a headless shell is; every capture script in this repo has
// carried its own copy of this fallback. This is that copy, once.

import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

export async function launchChromium(chromium) {
  try {
    return await chromium.launch()
  } catch (err) {
    const cache = join(process.env.HOME ?? "", "Library/Caches/ms-playwright")
    const shells = existsSync(cache)
      ? readdirSync(cache)
          .filter((d) => d.startsWith("chromium_headless_shell-"))
          .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
      : []
    for (const shell of shells) {
      const exe = join(cache, shell, "chrome-headless-shell-mac-arm64", "chrome-headless-shell")
      if (!existsSync(exe)) continue
      return await chromium.launch({ executablePath: exe })
    }
    throw new Error(`no usable chromium. ${String(err).split("\n")[0]}`)
  }
}
