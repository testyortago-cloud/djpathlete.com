import { getPrivateBucket } from "@/lib/firebase-admin"

export function safeStatementName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file"
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_")
  return cleaned.length > 120 ? cleaned.slice(0, 120) : cleaned
}
export async function storeStatementFile(path: string, buffer: Buffer, contentType: string): Promise<void> {
  await getPrivateBucket().file(path).save(buffer, { metadata: { contentType }, resumable: false })
}
export async function signStatementDownload(path: string, ttlSeconds = 300): Promise<string> {
  const [url] = await getPrivateBucket().file(path).getSignedUrl({ action: "read", expires: Date.now() + ttlSeconds * 1000 })
  return url
}
export async function deleteStatementFile(path: string): Promise<void> {
  await getPrivateBucket().file(path).delete({ ignoreNotFound: true })
}
