import { TabPlaceholder } from "@/components/admin/content-studio/TabPlaceholder"

interface PageProps {
  searchParams: Promise<{ tab?: string }>
}

export default async function ContentStudioPage({ searchParams }: PageProps) {
  const { tab } = await searchParams

  switch (tab) {
    case "calendar":
      return <TabPlaceholder tabName="Calendar" phaseLabel="Phase 4" />
    case "videos":
      return <TabPlaceholder tabName="Videos" phaseLabel="Phase 3" />
    case "posts":
      return <TabPlaceholder tabName="Posts" phaseLabel="Phase 3" />
    default:
      return <TabPlaceholder tabName="Pipeline" phaseLabel="Phase 3" />
  }
}
