import { AlertCircle } from "lucide-react"
import type { SocialPost, VideoTranscript, VideoUpload } from "@/types/database"

interface MetaTabProps {
  video: VideoUpload | null
  transcript: VideoTranscript | null
  posts: SocialPost[]
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5 border-b border-border last:border-0">
      <dt className="text-xs text-muted-foreground w-36 shrink-0 uppercase tracking-wide">
        {label}
      </dt>
      <dd className="text-sm text-primary break-all">{value}</dd>
    </div>
  )
}

export function MetaTab({ video, transcript, posts }: MetaTabProps) {
  const failed = posts.filter((p) => p.approval_status === "failed" && p.rejection_notes)
  const statusHistory = posts.map((p) => ({
    id: p.id,
    platform: p.platform,
    status: p.approval_status,
    updated_at: p.updated_at,
  }))

  return (
    <div className="px-6 py-4 space-y-6">
      <section>
        <h3 className="font-heading text-sm text-primary uppercase tracking-wide mb-2">
          Upload
        </h3>
        {video ? (
          <dl className="rounded-lg border border-border bg-white px-4 py-2">
            <MetaRow label="ID" value={video.id} />
            <MetaRow label="Filename" value={video.original_filename} />
            <MetaRow label="Storage path" value={video.storage_path} />
            <MetaRow label="Status" value={video.status} />
            <MetaRow
              label="Uploaded at"
              value={new Date(video.created_at).toLocaleString()}
            />
            <MetaRow
              label="Size"
              value={video.size_bytes ? `${video.size_bytes.toLocaleString()} bytes` : "—"}
            />
            <MetaRow
              label="Duration"
              value={video.duration_seconds ? `${video.duration_seconds}s` : "—"}
            />
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No source video for this post.
          </p>
        )}
      </section>

      {transcript && (
        <section>
          <h3 className="font-heading text-sm text-primary uppercase tracking-wide mb-2">
            Transcript
          </h3>
          <dl className="rounded-lg border border-border bg-white px-4 py-2">
            <MetaRow label="Source" value={transcript.source} />
            <MetaRow label="Language" value={transcript.language} />
            <MetaRow
              label="AssemblyAI job id"
              value={transcript.assemblyai_job_id ?? "—"}
            />
            <MetaRow
              label="Created at"
              value={new Date(transcript.created_at).toLocaleString()}
            />
          </dl>
        </section>
      )}

      <section>
        <h3 className="font-heading text-sm text-primary uppercase tracking-wide mb-2">
          Fanout history
        </h3>
        {statusHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No posts generated yet.</p>
        ) : (
          <ul className="text-sm text-primary space-y-1">
            {statusHistory.map((h) => (
              <li
                key={h.id}
                className="flex items-center gap-3 py-1 border-b border-border last:border-0"
              >
                <span className="w-24 text-xs uppercase tracking-wide text-muted-foreground">
                  {h.platform}
                </span>
                <span className="flex-1">{h.status}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(h.updated_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="font-heading text-sm text-primary uppercase tracking-wide mb-2">
          Publishing errors
        </h3>
        {failed.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No publishing errors.</p>
        ) : (
          <ul className="space-y-2">
            {failed.map((p) => (
              <li
                key={p.id}
                className="flex items-start gap-2 rounded-md border border-error/30 bg-error/5 p-2 text-sm text-error"
              >
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">
                    {p.platform} · {p.id}
                  </p>
                  <p className="mt-0.5">{p.rejection_notes}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
