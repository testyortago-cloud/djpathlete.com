#!/usr/bin/env python3
"""Generate the functions/ twins from the lib/ originals.

`functions/` has rootDir "src" and cannot import from `lib/`, so these files
exist twice. Generating rather than hand-copying means the only differences are
the import specifiers, which is exactly what the header of each twin claims.
"""
import pathlib, re

PAIRS = [
    ("lib/ai/openrouter.ts", "functions/src/ai/openrouter.ts"),
    ("lib/ai/openrouter-request.ts", "functions/src/ai/openrouter-request.ts"),
    ("lib/ai/openrouter-agent.ts", "functions/src/ai/openrouter-agent.ts"),
    ("lib/ai/openrouter-message.ts", "functions/src/ai/openrouter-message.ts"),
]

HEADER = (
    "// GENERATED TWIN of {src} — functions/ has rootDir \"src\" and cannot import\n"
    "// from lib/. Regenerate with scripts/gen-openrouter-twins.py rather than\n"
    "// editing by hand; the two must not drift.\n"
)

for src, dst in PAIRS:
    s = pathlib.Path(src)
    d = pathlib.Path(dst)
    text = s.read_text()

    # "@/lib/ai/x"  ->  "./x.js"   (NodeNext needs the .js specifier)
    text = re.sub(r'"@/lib/ai/([a-z-]+)"', r'"./\1.js"', text)
    # twin-pointer comments should name the OTHER file
    text = text.replace("functions/src/ai/", "lib/ai/") if False else text

    d.write_text(HEADER.format(src=src) + text)
    print(f"wrote {dst}")
