// LinkedIn's `commentary` is "little" text, where | { } @ [ ] ( ) < > # \ * _ ~
// are markup. Unescaped, "ACL (anterior cruciate)" can be mangled or cut short.
// https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format
// `#` is left alone when it starts a hashtag (followed by a letter or digit),
// because LinkedIn turns "#word" into a hashtag and escaping it would kill that.
const ALWAYS = /[\\|{}@[\]()<>*_~]/g

export function escapeLittleText(text: string): string {
  return text.replace(ALWAYS, (c) => `\\${c}`).replace(/#(?![\p{L}\p{N}])/gu, "\\#")
}
