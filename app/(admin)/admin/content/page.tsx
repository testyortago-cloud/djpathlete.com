import { TabContent } from "@/components/admin/content-studio/TabContent"

interface PageProps {
  searchParams: Promise<{ tab?: string }>
}

export default async function ContentStudioPage({ searchParams }: PageProps) {
  const { tab } = await searchParams
  return <TabContent tab={tab} />
}
