import { createServiceRoleClient } from "@/lib/supabase"
import type {
  PerformanceTest,
  PerformanceTestPR,
  TestType,
  BestMethod,
} from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export function computeIsPr(value: number, method: BestMethod, priorValues: number[]): boolean {
  if (priorValues.length === 0) return true
  if (method === "lowest") return value < Math.min(...priorValues)
  return value > Math.max(...priorValues)
}

export function computePctChange(current: number, prev: number | null): number | null {
  if (prev === null || prev === 0) return null
  return ((current - prev) / prev) * 100
}

export async function listByUser(
  clientUserId: string,
  opts: { testType?: TestType; from?: string; to?: string } = {},
) {
  const supabase = getClient()
  let q = supabase.from("performance_tests").select("*").eq("client_user_id", clientUserId)
  if (opts.testType) q = q.eq("test_type", opts.testType)
  if (opts.from) q = q.gte("test_date", opts.from)
  if (opts.to) q = q.lte("test_date", opts.to)
  const { data, error } = await q.order("test_date", { ascending: false })
  if (error) throw error
  return data as PerformanceTest[]
}

export async function getById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("performance_tests")
    .select("*")
    .eq("id", id)
    .single()
  if (error) return null
  return data as PerformanceTest
}

async function priorTestsForType(clientUserId: string, testType: TestType, excludeId?: string) {
  const supabase = getClient()
  let q = supabase
    .from("performance_tests")
    .select("id, result_value, test_date, best_method")
    .eq("client_user_id", clientUserId)
    .eq("test_type", testType)
  if (excludeId) q = q.neq("id", excludeId)
  const { data, error } = await q.order("test_date", { ascending: false })
  if (error) throw error
  return data as { id: string; result_value: number; test_date: string; best_method: BestMethod }[]
}

export async function create(
  clientUserId: string,
  payload: Omit<
    PerformanceTest,
    "id" | "client_user_id" | "created_by" | "is_pr" | "pct_change_from_prev" | "created_at" | "updated_at"
  >,
  createdBy: string,
) {
  const supabase = getClient()
  const prior = await priorTestsForType(clientUserId, payload.test_type)
  const priorValues = prior.map((p) => p.result_value)
  const prevValue = prior.length > 0 ? prior[0].result_value : null
  const is_pr = computeIsPr(payload.result_value, payload.best_method, priorValues)
  const pct_change_from_prev = computePctChange(payload.result_value, prevValue)

  const { data, error } = await supabase
    .from("performance_tests")
    .insert({
      client_user_id: clientUserId,
      created_by: createdBy,
      ...payload,
      is_pr,
      pct_change_from_prev,
    })
    .select()
    .single()
  if (error) throw error
  return data as PerformanceTest
}

export async function update(
  id: string,
  patch: Partial<
    Omit<
      PerformanceTest,
      "id" | "client_user_id" | "created_by" | "is_pr" | "pct_change_from_prev" | "created_at" | "updated_at"
    >
  >,
) {
  const supabase = getClient()
  const existing = await getById(id)
  if (!existing) throw new Error("performance_test not found")
  const merged = { ...existing, ...patch }
  const prior = await priorTestsForType(existing.client_user_id, merged.test_type, id)
  const earlier = prior.filter((p) => p.test_date <= merged.test_date)
  const priorValues = earlier.map((p) => p.result_value)
  const prevValue = earlier.length > 0 ? earlier[0].result_value : null
  const is_pr = computeIsPr(merged.result_value, merged.best_method, priorValues)
  const pct_change_from_prev = computePctChange(merged.result_value, prevValue)

  const { data, error } = await supabase
    .from("performance_tests")
    .update({ ...patch, is_pr, pct_change_from_prev })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error

  await recomputeDownstream(existing.client_user_id, merged.test_type, merged.test_date)
  return data as PerformanceTest
}

export async function deleteTest(id: string) {
  const existing = await getById(id)
  if (!existing) return
  const supabase = getClient()
  const { error } = await supabase.from("performance_tests").delete().eq("id", id)
  if (error) throw error
  await recomputeDownstream(existing.client_user_id, existing.test_type, existing.test_date)
}

async function recomputeDownstream(clientUserId: string, testType: TestType, fromDate: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("performance_tests")
    .select("id, result_value, test_date, best_method")
    .eq("client_user_id", clientUserId)
    .eq("test_type", testType)
    .gt("test_date", fromDate)
    .order("test_date", { ascending: true })
  if (error) throw error
  for (const row of data ?? []) {
    const earlier = (await priorTestsForType(clientUserId, testType, row.id)).filter(
      (p) => p.test_date <= row.test_date,
    )
    const priorValues = earlier.map((p) => p.result_value)
    const prevValue = earlier.length > 0 ? earlier[0].result_value : null
    const is_pr = computeIsPr(row.result_value, row.best_method as BestMethod, priorValues)
    const pct_change_from_prev = computePctChange(row.result_value, prevValue)
    await supabase
      .from("performance_tests")
      .update({ is_pr, pct_change_from_prev })
      .eq("id", row.id)
  }
}

export async function getPRsByUser(clientUserId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("performance_test_pr_view")
    .select("*")
    .eq("client_user_id", clientUserId)
  if (error) throw error
  return data as PerformanceTestPR[]
}

export async function getTestHistory(clientUserId: string, testType: TestType) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("performance_tests")
    .select("*")
    .eq("client_user_id", clientUserId)
    .eq("test_type", testType)
    .order("test_date", { ascending: true })
  if (error) throw error
  return data as PerformanceTest[]
}
