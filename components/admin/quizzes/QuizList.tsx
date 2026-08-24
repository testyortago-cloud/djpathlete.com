// The quizzes list, in the house table.
//
// `components/ui/data-table.tsx` throughout — never a hand-rolled <table>.
// That is exactly how /admin/team ended up with a grey header bar and square
// corners, reading as a different app.

import Link from "next/link"
import {
  DataTable,
  DataTableBadge,
  DataTableCard,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableToolbar,
  type DataTableBadgeTone,
} from "@/components/ui/data-table"

export interface QuizListItem {
  id: string
  key: string
  name: string
  status: string
  seedMarker: string | null
  updatedAt: string | null
  attempts: { total: number; completed: number }
}

const STATUS_TONE: Record<string, DataTableBadgeTone> = {
  active: "success",
  draft: "warning",
  archived: "neutral",
}

export function QuizList({ quizzes }: { quizzes: QuizListItem[] }) {
  const seeded = quizzes.filter((quiz) => quiz.seedMarker !== null)

  return (
    <DataTableCard>
      <DataTableToolbar>
        <p className="text-sm text-muted-foreground">
          {quizzes.length} {quizzes.length === 1 ? "quiz" : "quizzes"}
        </p>
      </DataTableToolbar>

      {/* THE UNVERIFIED BANNER. A seeded quiz carries numbers reconstructed
          from GHL field metadata, not recovered from the original workflows —
          the weights and cutoffs did not survive the export. Saying so on
          screen is the difference between a plausible default and a decision
          somebody made. */}
      {seeded.length > 0 ? (
        <div className="border-b border-border bg-warning/10 px-4 py-3 text-sm text-foreground">
          <strong className="font-semibold">
            {seeded.length === 1 ? "One quiz still carries" : `${seeded.length} quizzes still carry`} reconstructed
            scoring.
          </strong>{" "}
          The weights and tier cutoffs were rebuilt from field metadata, not recovered — the original GoHighLevel
          workflows exported without them. Review them before trusting a result.
        </div>
      ) : null}

      <DataTable>
        <DataTableHeader>
          <DataTableHead>Quiz</DataTableHead>
          <DataTableHead>Status</DataTableHead>
          <DataTableHead>Completed</DataTableHead>
          <DataTableHead>Started</DataTableHead>
          <DataTableHead>Updated</DataTableHead>
        </DataTableHeader>
        <tbody>
          {quizzes.length === 0 ? (
            <DataTableEmpty colSpan={5}>
              No quizzes yet. Seed the Athlete Quiz with scripts/seed-athlete-quiz.ts.
            </DataTableEmpty>
          ) : (
            quizzes.map((quiz) => (
              <DataTableRow key={quiz.id}>
                <DataTableCell>
                  <Link
                    href={`/admin/funnels/quizzes/${quiz.id}`}
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {quiz.name}
                  </Link>
                  <span className="mt-0.5 block font-mono text-xs text-muted-foreground">{quiz.key}</span>
                  {quiz.seedMarker ? (
                    <DataTableBadge tone="warning" className="mt-1.5">
                      Unverified scoring
                    </DataTableBadge>
                  ) : null}
                </DataTableCell>
                <DataTableCell>
                  <DataTableBadge tone={STATUS_TONE[quiz.status] ?? "neutral"}>{quiz.status}</DataTableBadge>
                </DataTableCell>
                <DataTableCell>{quiz.attempts.completed}</DataTableCell>
                {/* Started, not "total": the gap between the two IS the
                    drop-off, and showing only completions makes an abandoned
                    quiz look like an unused one. */}
                <DataTableCell>{quiz.attempts.total}</DataTableCell>
                <DataTableCell>
                  {quiz.updatedAt ? new Date(quiz.updatedAt).toLocaleDateString("en-GB") : "—"}
                </DataTableCell>
              </DataTableRow>
            ))
          )}
        </tbody>
      </DataTable>
    </DataTableCard>
  )
}
