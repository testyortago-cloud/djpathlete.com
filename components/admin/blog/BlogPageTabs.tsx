"use client"

import { useState } from "react"
import { FileText, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { BlogPostList } from "./BlogPostList"
import { BlogGenerationHistory } from "./BlogGenerationHistory"
import type { BlogPost } from "@/types/database"

const tabs = [
  { id: "posts", label: "Posts", icon: FileText },
  { id: "ai-history", label: "AI History", icon: Sparkles },
] as const

type TabId = (typeof tabs)[number]["id"]

export function BlogPageTabs({ posts }: { posts: BlogPost[] }) {
  const [activeTab, setActiveTab] = useState<TabId>("posts")

  return (
    <div>
      {/* Tab bar */}
      <div className="flex items-center gap-1 bg-surface rounded-lg p-1 mb-4 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              activeTab === tab.id ? "bg-white text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <tab.icon className="size-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "posts" && <BlogPostList posts={posts} />}
      {activeTab === "ai-history" && <BlogGenerationHistory />}
    </div>
  )
}
