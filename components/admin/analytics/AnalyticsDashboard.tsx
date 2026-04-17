"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { DollarSign, Users, BarChart3, Activity, ShoppingBag } from "lucide-react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { DateRangePicker } from "./DateRangePicker"
import { RevenueTab } from "./RevenueTab"
import { ClientsTab } from "./ClientsTab"
import { ProgramsTab } from "./ProgramsTab"
import { EngagementTab } from "./EngagementTab"
import { ShopTab } from "./ShopTab"
import type {
  RevenueMetrics,
  ClientMetrics,
  ProgramMetrics,
  EngagementMetrics,
  ShopMetrics,
} from "@/types/analytics"

const TABS = [
  { value: "revenue", label: "Revenue", icon: DollarSign },
  { value: "shop", label: "Shop", icon: ShoppingBag },
  { value: "clients", label: "Clients", icon: Users },
  { value: "programs", label: "Programs", icon: BarChart3 },
  { value: "engagement", label: "Engagement", icon: Activity },
] as const

interface AnalyticsDashboardProps {
  activeTab: string
  currentMonths: number
  customFrom?: string
  customTo?: string
  revenue: RevenueMetrics
  shop: ShopMetrics
  clients: ClientMetrics
  programs: ProgramMetrics
  engagement: EngagementMetrics
}

export function AnalyticsDashboard({
  activeTab,
  currentMonths,
  customFrom,
  customTo,
  revenue,
  shop,
  clients,
  programs,
  engagement,
}: AnalyticsDashboardProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function handleTabChange(value: string) {
    const sp = new URLSearchParams(searchParams.toString())
    if (value === "revenue") {
      sp.delete("tab")
    } else {
      sp.set("tab", value)
    }
    const qs = sp.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-semibold text-primary">Analytics</h1>
        <DateRangePicker currentMonths={currentMonths} customFrom={customFrom} customTo={customTo} />
      </div>

      <Tabs defaultValue={activeTab} onValueChange={handleTabChange}>
        <TabsList variant="line" className="mb-6 w-full sm:w-auto">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
              <tab.icon className="size-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="revenue">
          <RevenueTab data={revenue} />
        </TabsContent>
        <TabsContent value="shop">
          <ShopTab data={shop} />
        </TabsContent>
        <TabsContent value="clients">
          <ClientsTab data={clients} />
        </TabsContent>
        <TabsContent value="programs">
          <ProgramsTab data={programs} />
        </TabsContent>
        <TabsContent value="engagement">
          <EngagementTab data={engagement} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
