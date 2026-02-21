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
      <div className="flex items-center gap-1.5 mb-4 overflow-x-auto scrollbar-none -mx-1 px-1 pb-1">
        {TABS.map((tab) => {
          const count = tab.value === "all"
            ? achievements.length
            : achievements.filter((a) => a.achievement_type === tab.value).length
          return (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-colors shrink-0 ${
                activeTab === tab.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-white border border-border text-muted-foreground hover:text-foreground hover:bg-surface"
              }`}
            >
              {tab.label}
              <span className={`ml-1 ${activeTab === tab.value ? "text-primary-foreground/70" : "text-muted-foreground/50"}`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-8 sm:py-12">
          <p className="text-xs sm:text-sm text-muted-foreground">
            No achievements in this category yet. Keep training!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-4">
          {filtered.map((achievement) => (
            <AchievementCard key={achievement.id} achievement={achievement} />
          ))}
        </div>
      )}
    </div>
  )
}
