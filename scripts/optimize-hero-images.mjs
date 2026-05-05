import sharp from "sharp"
import { readdir, stat, rename, unlink } from "node:fs/promises"
import { join } from "node:path"

const PUBLIC_IMAGES = "public/images"
const TARGETS = [
  { file: "professionalheadshot.jpg", maxSide: 1600, quality: 82 },
  { file: "gym-training-01.jpg", maxSide: 2000, quality: 80 },
  { file: "gym-training-02.jpg", maxSide: 2000, quality: 80 },
  { file: "gym-training-03.jpg", maxSide: 2000, quality: 80 },
]

const fmt = (n) => `${(n / 1024).toFixed(0)} KB`

for (const { file, maxSide, quality } of TARGETS) {
  const src = join(PUBLIC_IMAGES, file)
  const tmp = join(PUBLIC_IMAGES, `.${file}.tmp`)
  const before = (await stat(src)).size

  const meta = await sharp(src).metadata()
  await sharp(src)
    .rotate()
    .resize({
      width: meta.width >= meta.height ? maxSide : null,
      height: meta.height > meta.width ? maxSide : null,
      withoutEnlargement: true,
      fit: "inside",
    })
    .jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:2:0" })
    .withMetadata({ orientation: 1 })
    .toFile(tmp)

  const after = (await stat(tmp)).size
  await unlink(src)
  await rename(tmp, src)

  const out = await sharp(src).metadata()
  console.log(`${file}: ${fmt(before)} → ${fmt(after)}  (${out.width}×${out.height})`)
}
