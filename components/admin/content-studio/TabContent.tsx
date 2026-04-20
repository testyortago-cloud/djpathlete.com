import { TabPlaceholder } from "./TabPlaceholder"

export function TabContent({ tab }: { tab?: string }) {
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
