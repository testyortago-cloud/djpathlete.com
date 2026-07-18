// Pure, date-driven, generic timing considerations (Phase 5) — never tax advice.
export interface YearEndFlag {
  id: "q4_timing" | "substantiation_gaps" | "uncategorized_expenses" | "home_office_unset"
  title: string
  detail: string
}

export interface YearEndInputs {
  today: string
  from: string
  to: string
  gap_count: number
  uncategorized_expense_count: number
  home_office_percent_set: boolean
  home_office_input_total_cents: number
}

export function yearEndFlags(input: YearEndInputs): YearEndFlag[] {
  const flags: YearEndFlag[] = []
  const todayMonth = Number(input.today.slice(5, 7))
  if (todayMonth >= 10 && input.to.slice(0, 4) === input.today.slice(0, 4)) {
    flags.push({
      id: "q4_timing",
      title: "Year-end is approaching",
      detail:
        "If you're planning deductible purchases (equipment, software), buying before Dec 31 may place the deduction in this tax year. Your CPA confirms what applies.",
    })
  }
  if (input.gap_count > 0) {
    flags.push({
      id: "substantiation_gaps",
      title: `${input.gap_count} ${input.gap_count === 1 ? "entry is" : "entries are"} missing a business purpose`,
      detail:
        "Each entry on a purpose-required category without a stated business purpose is a deduction the IRS could disallow. Fill them in before filing.",
    })
  }
  if (input.uncategorized_expense_count > 0) {
    flags.push({
      id: "uncategorized_expenses",
      title: `${input.uncategorized_expense_count} expense ${input.uncategorized_expense_count === 1 ? "entry has" : "entries have"} no category`,
      detail: "Uncategorized money can't be matched to a deduction. Assign categories in the ledger.",
    })
  }
  if (!input.home_office_percent_set && input.home_office_input_total_cents > 0) {
    flags.push({
      id: "home_office_unset",
      title: "Household rent/utility spending is recorded, but no office share % is set",
      detail:
        "Enter your office share on the home-office card to see the proposal estimate. Your CPA confirms the method and the final percentage.",
    })
  }
  return flags
}
