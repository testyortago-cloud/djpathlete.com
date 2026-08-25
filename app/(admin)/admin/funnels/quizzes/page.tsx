// THE QUIZZES LIST IS GONE. This route only forwards.
//
// A quiz is not a thing this product has alongside funnels — it is something a
// funnel can RUN, the way a funnel can take a payment. A separate screen made
// it a permanent top-level concept, which is wrong twice over: it is wrong for
// this business, where the quiz is one funnel's mechanism, and it is wrong for
// white-labelling, where a customer whose work has no quizzes in it must never
// meet the word at all.
//
// The quiz is now reached from the funnel that runs it: a control on that
// funnel's card, and the panel on its settings screen. `/admin/funnels/quizzes/<id>`
// — the editor for ONE quiz's questions — is untouched and is where those go.
// It keeps its own URL rather than nesting under a funnel because two funnels
// can point at one quiz, so `/admin/funnels/<id>/quiz` would be a lie about
// ownership.
//
// A REDIRECT, NOT A DELETED ROUTE. This URL was linked from the funnels board
// for a week and is in browser histories; a 404 for a bookmark is a worse
// answer than the screen that replaced it.
import { redirect } from "next/navigation"

export default function QuizzesScreen(): never {
  redirect("/admin/funnels")
}
