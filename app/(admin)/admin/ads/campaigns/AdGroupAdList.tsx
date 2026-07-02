"use client"

import type { GoogleAdsAd, GoogleAdsAdGroup } from "@/types/database"
import { ResourceStatusToggle } from "./ResourceStatusToggle"

export type AdGroupWithAds = GoogleAdsAdGroup & { ads: GoogleAdsAd[] }

export function AdGroupAdList({ adGroups }: { adGroups: AdGroupWithAds[] }) {
  if (adGroups.length === 0) {
    return <p className="text-xs text-muted-foreground py-1">No ad groups synced.</p>
  }

  return (
    <div className="space-y-4">
      {adGroups.map((ag) => (
        <div key={ag.id} className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-foreground">{ag.name}</span>
            <ResourceStatusToggle
              endpoint={`/api/admin/ads/ad-groups/${ag.id}/status`}
              resourceKind="ad group"
              resourceName={ag.name}
              initialStatus={ag.status}
            />
          </div>
          {ag.ads.length === 0 ? (
            <p className="pl-6 text-xs text-muted-foreground">No ads synced.</p>
          ) : (
            <div className="pl-6 space-y-1.5 border-l border-border/60">
              {ag.ads.map((ad) => {
                const headline = ad.headlines?.[0]?.text ?? ad.ad_id
                return (
                  <div key={ad.id} className="flex items-center gap-3 pl-3">
                    <span className="text-xs text-muted-foreground">{headline}</span>
                    <ResourceStatusToggle
                      endpoint={`/api/admin/ads/ads/${ad.id}/status`}
                      resourceKind="ad"
                      resourceName={headline}
                      initialStatus={ad.status}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
