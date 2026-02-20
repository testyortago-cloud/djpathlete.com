"use client"

import { useState } from "react"
import { AchievementCard } from "@/components/client/AchievementCard"
import type { Achievement, AchievementType } from "@/types/database"

interface AchievementFilterTabsProps {
  achievements: Achievement[]
}

const TABS: Array<{ label: string; value: AchievementType | "all" }> = [
  { label: "All", value: "all" },
  { label: "PRs", value: "pr" },
  { label: "Streaks", value: "streak" },
  { label: "Milestones", value: "milestone" },
]

export function AchievementFilterTabs({
  achievements,
}: AchievementFilterTabsProps) {
  const [activeTab, setActiveTab] = useState<AchievementType | "all">("all")

  const filtered =
    activeTab === "all"
      ? achievements
      : achievements.filter((a) => a.achievement_type === activeTab)

  return (
    <div>
      {/* Tabs */}
      <div className="flex items-center gap-2 mb-6 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === tab.value
                ? "bg-primary text-primary-foreground"
                : "bg-white border border-border text-muted-foreground hover:text-foreground hover:bg-surface"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">
            No achievements in this category yet. Keep training!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((achievement) => (
            <AchievementCard key={achievement.id} achievement={achievement} />
          ))}
        </div>
      )}
    </div>
  )
}
