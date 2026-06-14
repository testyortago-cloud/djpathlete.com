"use client"

import { useState } from "react"
import { ref, uploadBytesResumable } from "firebase/storage"
import { storage } from "@/lib/firebase"
import { toast } from "sonner"

export const FORM_REVIEW_MAX_SIZE_MB = 250
export const FORM_REVIEW_MAX_DURATION_SECONDS = 300 // 5 minutes
export const FORM_REVIEW_ACCEPTED_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-msvideo"]

/**
 * Shared Firebase video upload + client-side validation for form reviews.
 * Used by the standalone upload page and the in-workout upload dialog.
 */
export function useFormReviewUpload(userId: string) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  /** Returns true if the file passes size/type/duration checks (toasts on failure). */
  async function validateVideo(file: File): Promise<boolean> {
    if (file.size > FORM_REVIEW_MAX_SIZE_MB * 1024 * 1024) {
      toast.error(`Video must be under ${FORM_REVIEW_MAX_SIZE_MB}MB`)
      return false
    }
    if (!FORM_REVIEW_ACCEPTED_TYPES.includes(file.type)) {
      toast.error("Unsupported video format. Use MP4, MOV, WebM, or AVI.")
      return false
    }
    return new Promise((resolve) => {
      const video = document.createElement("video")
      video.preload = "metadata"
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(video.src)
        if (video.duration > FORM_REVIEW_MAX_DURATION_SECONDS) {
          toast.error("Video must be 5 minutes or less")
          resolve(false)
        } else {
          resolve(true)
        }
      }
      video.onerror = () => {
        URL.revokeObjectURL(video.src)
        resolve(true) // can't read duration — allow it
      }
      video.src = URL.createObjectURL(file)
    })
  }

  /** Uploads to form-reviews/{userId}/{timestamp}.{ext}; returns the storage path. */
  async function uploadVideo(file: File): Promise<string> {
    setUploading(true)
    setProgress(0)
    try {
      const ext = file.name.split(".").pop() ?? "mp4"
      const videoPath = `form-reviews/${userId}/${Date.now()}.${ext}`
      const storageRef = ref(storage, videoPath)
      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, file)
        task.on(
          "state_changed",
          (snap) => setProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
          (err) => reject(err),
          () => resolve(),
        )
      })
      return videoPath
    } finally {
      setUploading(false)
    }
  }

  return { uploading, progress, validateVideo, uploadVideo }
}
