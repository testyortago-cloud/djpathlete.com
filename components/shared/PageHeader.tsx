interface PageHeaderProps {
  title: string
  description: string
  children?: React.ReactNode
}

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl sm:text-2xl font-semibold text-primary">{title}</h1>
        {children}
      </div>
      <p className="text-sm text-muted-foreground mt-1">{description}</p>
    </div>
  )
}
