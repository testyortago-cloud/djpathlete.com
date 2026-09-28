// Limits on the documents a coach attaches to "Generate with AI".
//
// One source for the dialog, the text-extraction route and the generate
// route. They used to be written out separately, and they disagreed: the
// dialog let a coach attach 5 documents while the generate route refused more
// than 3, so a fourth document turned every attempt into a bare "Invalid
// request." with nothing on screen saying why.

export const MAX_REFERENCE_FILES = 5

/** Characters kept from each document. Longer text is cut to this. */
export const MAX_REFERENCE_FILE_CHARS = 50_000
