"use client"

import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Image from "@tiptap/extension-image"
import Link from "@tiptap/extension-link"
import Placeholder from "@tiptap/extension-placeholder"
import Underline from "@tiptap/extension-underline"
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  ImageIcon,
  Undo,
  Redo,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useRef } from "react"

interface BlogEditorProps {
  content: string
  onChange: (html: string) => void
}

export function BlogEditor({ content, onChange }: BlogEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Underline,
      Image.configure({ inline: false, allowBase64: false }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-primary underline" },
      }),
      Placeholder.configure({
        placeholder: "Start writing your blog post...",
      }),
    ],
    immediatelyRender: false,
    content,
    onUpdate: ({ editor: e }) => {
      onChange(e.getHTML())
    },
    editorProps: {
      attributes: {
        class: "prose prose-lg max-w-none min-h-[400px] px-6 py-4 focus:outline-none",
      },
    },
  })

  if (!editor) return null

  async function handleImageUpload(file: File) {
    const formData = new FormData()
    formData.append("file", file)
    formData.append("type", "content")

    try {
      const res = await fetch("/api/upload/blog-image", {
        method: "POST",
        body: formData,
      })
      if (!res.ok) throw new Error("Upload failed")
      const { url } = await res.json()
      editor?.chain().focus().setImage({ src: url }).run()
    } catch {
      // Silently fail — user can retry
    }
  }

  function insertLink() {
    const url = window.prompt("Enter URL:")
    if (!url) return
    editor?.chain().focus().extendMarkRange("link").setLink({ href: url }).run()
  }

  const tools = [
    {
      icon: Bold,
      action: () => editor.chain().focus().toggleBold().run(),
      active: editor.isActive("bold"),
      title: "Bold",
    },
    {
      icon: Italic,
      action: () => editor.chain().focus().toggleItalic().run(),
      active: editor.isActive("italic"),
      title: "Italic",
    },
    {
      icon: UnderlineIcon,
      action: () => editor.chain().focus().toggleUnderline().run(),
      active: editor.isActive("underline"),
      title: "Underline",
    },
    { divider: true },
    {
      icon: Heading2,
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      active: editor.isActive("heading", { level: 2 }),
      title: "Heading 2",
    },
    {
      icon: Heading3,
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      active: editor.isActive("heading", { level: 3 }),
      title: "Heading 3",
    },
    { divider: true },
    {
      icon: List,
      action: () => editor.chain().focus().toggleBulletList().run(),
      active: editor.isActive("bulletList"),
      title: "Bullet List",
    },
    {
      icon: ListOrdered,
      action: () => editor.chain().focus().toggleOrderedList().run(),
      active: editor.isActive("orderedList"),
      title: "Ordered List",
    },
    {
      icon: Quote,
      action: () => editor.chain().focus().toggleBlockquote().run(),
      active: editor.isActive("blockquote"),
      title: "Blockquote",
    },
    { divider: true },
    {
      icon: LinkIcon,
      action: insertLink,
      active: editor.isActive("link"),
      title: "Link",
    },
    {
      icon: ImageIcon,
      action: () => fileInputRef.current?.click(),
      active: false,
      title: "Image",
    },
    { divider: true },
    {
      icon: Undo,
      action: () => editor.chain().focus().undo().run(),
      active: false,
      title: "Undo",
    },
    {
      icon: Redo,
      action: () => editor.chain().focus().redo().run(),
      active: false,
      title: "Redo",
    },
  ] as const

  return (
    <div className="rounded-xl border border-border bg-white overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-border bg-surface/50">
        {tools.map((tool, i) =>
          "divider" in tool ? (
            <div key={`d-${i}`} className="w-px h-5 bg-border mx-1" />
          ) : (
            <button
              key={tool.title}
              type="button"
              onClick={tool.action}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                tool.active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface",
              )}
              title={tool.title}
            >
              <tool.icon className="size-4" />
            </button>
          ),
        )}
      </div>

      {/* Hidden file input for image upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleImageUpload(file)
          e.target.value = ""
        }}
      />

      {/* Editor */}
      <EditorContent editor={editor} />
    </div>
  )
}
