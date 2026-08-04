"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { SmilePlus } from "lucide-react"
import { EmojiStyle } from "emoji-picker-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

// The picker pulls in the whole emoji dataset; keep it out of the shell bundle.
const EmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false })

/**
 * NATIVE is not the library default — the Apple/Google/Twitter/Facebook styles
 * fetch PNG sprites from cdn.jsdelivr.net, a host this app's CSP does not allow.
 * Rendering the unicode character keeps the picker fully self-contained.
 *
 * Getting this wrong degrades to blank tiles rather than an error, which is
 * exactly the kind of break nobody notices, so a test asserts it.
 */
export const EMOJI_STYLE = EmojiStyle.NATIVE

export function EmojiPickerPopover({
  onPick,
  label = "Add reaction",
}: {
  onPick: (emoji: string) => void
  label?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={label}
        className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
      >
        <SmilePlus className="size-4" strokeWidth={1.5} />
      </PopoverTrigger>
      <PopoverContent className="w-auto border-none bg-transparent p-0 shadow-none" align="end">
        <EmojiPicker
          emojiStyle={EMOJI_STYLE}
          lazyLoadEmojis={false}
          skinTonesDisabled
          searchPlaceholder="Search emoji"
          previewConfig={{ showPreview: false }}
          width={320}
          height={380}
          onEmojiClick={(data: { emoji: string }) => {
            onPick(data.emoji)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
