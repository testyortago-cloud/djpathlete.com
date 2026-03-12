"use client"

import { useState, useRef } from "react"
import { VideoPlayer } from "@/components/shared/VideoPlayer"
import { YouTubeEmbed } from "@/components/shared/YouTubeEmbed"
import { AssessmentExerciseThread } from "@/components/shared/AssessmentExerciseThread"
import { Button } from "@/components/ui/button"
import {
  CheckCircle2,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Youtube,
  Video,
  Upload,
  Loader2,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { ref, uploadBytesResumable } from "firebase/storage"
import { storage } from "@/lib/firebase"
import type { PerformanceAssessmentStatus } from "@/types/database"

interface AssessmentExercise {
  id: string
  exercise_id: string | null
  custom_name: string | null
  youtube_url: string | null
  video_path: string | null
  admin_notes: string | null
  order_index: number
  exercises?: { id: string; name: string } | null
}

interface Message {
  id: string
  user_id: string
  message: string
  created_at: string
  users?: {
    first_name: string
    last_name: string
    avatar_url?: string | null
    role?: string
  } | null
}

interface PerformanceAssessmentClientDetailProps {
  assessment: {
    id: string
    title: string
    notes: string | null
    status: string
    created_at: string
  }
  exercises: AssessmentExercise[]
  messagesMap: Record<string, Message[]>
  videoUrlsMap: Record<string, string>
  currentUserId: string
}

const MAX_SIZE_MB = 250
const MAX_DURATION_SECONDS = 300
const ACCEPTED_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-msvideo"]

export function PerformanceAssessmentClientDetail({
  assessment,
  exercises,
  messagesMap,
  videoUrlsMap,
  currentUserId,
}: PerformanceAssessmentClientDetailProps) {
  const [expandedExercises, setExpandedExercises] = useState<Set<string>>(
    new Set(exercises.map((e) => e.id))
  )
  const [uploadingExercise, setUploadingExercise] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadedVideos, setUploadedVideos] = useState<Record<string, string>>(videoUrlsMap)
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const isInProgress = assessment.status === "in_progress"

  function toggleExercise(id: string) {
    setExpandedExercises((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function validateVideo(videoFile: File): Promise<boolean> {
    if (videoFile.size > MAX_SIZE_MB * 1024 * 1024) {
      toast.error(`Video must be under ${MAX_SIZE_MB}MB`)
      return false
    }
    if (!ACCEPTED_TYPES.includes(videoFile.type)) {
      toast.error("Unsupported format. Use MP4, MOV, WebM, or AVI.")
      return false
    }
    return new Promise((resolve) => {
      const video = document.createElement("video")
      video.preload = "metadata"
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(video.src)
        if (video.duration > MAX_DURATION_SECONDS) {
          toast.error("Video must be 5 minutes or less")
          resolve(false)
        } else {
          resolve(true)
        }
      }
      video.onerror = () => {
        URL.revokeObjectURL(video.src)
        resolve(true)
      }
      video.src = URL.createObjectURL(videoFile)
    })
  }

  async function handleUpload(exerciseId: string, file: File) {
    const valid = await validateVideo(file)
    if (!valid) return

    setUploadingExercise(exerciseId)
    setUploadProgress(0)

    try {
      const ext = file.name.split(".").pop() ?? "mp4"
      const videoPath = `performance-assessments/${assessment.id}/${exerciseId}/${Date.now()}.${ext}`
      const storageRef = ref(storage, videoPath)

      await new Promise<void>((resolve, reject) => {
        const uploadTask = uploadBytesResumable(storageRef, file)
        uploadTask.on(
          "state_changed",
          (snapshot) => {
            const pct = Math.round(
              (snapshot.bytesTransferred / snapshot.totalBytes) * 100
            )
            setUploadProgress(pct)
          },
          (error) => reject(error),
          () => resolve()
        )
      })

      // Save video_path to the exercise record
      const res = await fetch(
        `/api/client/performance-assessments/${assessment.id}/exercises/${exerciseId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ video_path: videoPath }),
        }
      )

      if (!res.ok) throw new Error("Failed to save video")

      // Create a temporary URL for preview
      setUploadedVideos((prev) => ({
        ...prev,
        [exerciseId]: URL.createObjectURL(file),
      }))

      toast.success("Video uploaded!")
    } catch (err) {
      console.error("Upload error:", err)
      toast.error(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploadingExercise(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold text-primary">
          {assessment.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-muted-foreground">
          <span>
            {new Date(assessment.created_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
          <span className="text-border">|</span>
          <span>{exercises.length} exercises</span>
          <span className="text-border">|</span>
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full",
              assessment.status === "in_progress"
                ? "bg-blue-100 text-blue-700"
                : "bg-green-100 text-green-700"
            )}
          >
            {assessment.status === "in_progress" ? (
              <><MessageSquare className="size-3" /> In Progress</>
            ) : (
              <><CheckCircle2 className="size-3" /> Completed</>
            )}
          </span>
        </div>
      </div>

      {/* Assessment notes */}
      {assessment.notes && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground mb-1">Coach Notes</h3>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{assessment.notes}</p>
        </div>
      )}

      {/* Exercises */}
      <div className="space-y-3">
        {exercises.map((exercise, index) => {
          const exerciseName = exercise.exercises?.name ?? exercise.custom_name ?? "Unnamed"
          const isExpanded = expandedExercises.has(exercise.id)
          const messages = messagesMap[exercise.id] ?? []
          const videoUrl = uploadedVideos[exercise.id]
          const isUploading = uploadingExercise === exercise.id

          return (
            <div
              key={exercise.id}
              className="bg-white rounded-xl border border-border overflow-hidden"
            >
              {/* Header */}
              <button
                type="button"
                onClick={() => toggleExercise(exercise.id)}
                className="w-full flex items-center justify-between p-4 hover:bg-surface/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-muted-foreground w-6">
                    {index + 1}.
                  </span>
                  <span className="text-sm font-medium text-foreground">{exerciseName}</span>
                  {exercise.youtube_url && (
                    <Youtube className="size-4 text-red-500" />
                  )}
                  {(exercise.video_path || uploadedVideos[exercise.id]) && (
                    <Video className="size-4 text-green-600" />
                  )}
                  {messages.length > 0 && (
                    <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                      {messages.length}
                    </span>
                  )}
                </div>
                {isExpanded ? (
                  <ChevronUp className="size-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-4 text-muted-foreground" />
                )}
              </button>

              {/* Expanded */}
              {isExpanded && (
                <div className="border-t border-border p-4 space-y-4">
                  {/* Coach notes */}
                  {exercise.admin_notes && (
                    <div className="bg-surface rounded-lg p-3">
                      <p className="text-xs font-medium text-muted-foreground mb-1">Coach Notes</p>
                      <p className="text-sm text-foreground whitespace-pre-wrap">
                        {exercise.admin_notes}
                      </p>
                    </div>
                  )}

                  {/* YouTube example */}
                  {exercise.youtube_url && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                        <Youtube className="size-3.5 text-red-500" />
                        Example Video
                      </p>
                      <YouTubeEmbed url={exercise.youtube_url} />
                    </div>
                  )}

                  {/* Client video upload / display */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Video className="size-3.5" />
                      Your Video
                    </p>

                    {videoUrl ? (
                      <div className="space-y-2">
                        <VideoPlayer src={videoUrl} />
                        {isInProgress && (
                          <button
                            type="button"
                            onClick={() => fileRefs.current[exercise.id]?.click()}
                            className="text-xs text-primary hover:underline"
                          >
                            Replace video
                          </button>
                        )}
                      </div>
                    ) : isInProgress ? (
                      <div
                        className={cn(
                          "relative border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer",
                          "border-border hover:border-primary/40"
                        )}
                        onClick={() => fileRefs.current[exercise.id]?.click()}
                      >
                        {isUploading ? (
                          <div className="space-y-2">
                            <Loader2 className="size-8 text-primary mx-auto animate-spin" />
                            <div className="h-2 bg-muted rounded-full overflow-hidden max-w-xs mx-auto">
                              <div
                                className="h-full bg-primary rounded-full transition-all duration-300"
                                style={{ width: `${uploadProgress}%` }}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Uploading... {uploadProgress}%
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <Upload className="size-8 text-muted-foreground mx-auto" />
                            <p className="text-sm text-muted-foreground">
                              Tap to upload your video
                            </p>
                            <p className="text-xs text-muted-foreground">
                              MP4, MOV, WebM, or AVI. Max {MAX_SIZE_MB}MB, 5 minutes.
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="bg-muted rounded-xl p-6 text-center text-sm text-muted-foreground">
                        No video uploaded
                      </div>
                    )}

                    <input
                      ref={(el) => { fileRefs.current[exercise.id] = el }}
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleUpload(exercise.id, file)
                        e.target.value = ""
                      }}
                    />
                  </div>

                  {/* Thread */}
                  <div className="border-t border-border pt-4">
                    <AssessmentExerciseThread
                      messages={messages}
                      currentUserId={currentUserId}
                      assessmentId={assessment.id}
                      exerciseId={exercise.id}
                      apiBasePath="/api/client/performance-assessments"
                    />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
