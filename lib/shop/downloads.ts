import { getPrivateBucket } from "@/lib/firebase-admin"

export async function generateSignedDownloadUrl(
  storagePath: string,
  ttlSeconds: number,
): Promise<string> {
  const bucket = getPrivateBucket()
  const [url] = await bucket.file(storagePath).getSignedUrl({
    action: "read",
    expires: Date.now() + ttlSeconds * 1000,
  })
  return url
}

export async function generateSignedUploadUrl(
  storagePath: string,
  contentType: string,
  ttlSeconds: number = 600,
): Promise<string> {
  const bucket = getPrivateBucket()
  const [url] = await bucket.file(storagePath).getSignedUrl({
    action: "write",
    expires: Date.now() + ttlSeconds * 1000,
    contentType,
  })
  return url
}
