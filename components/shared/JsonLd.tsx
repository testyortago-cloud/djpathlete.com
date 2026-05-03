interface JsonLdProps {
  data: Record<string, unknown> | Record<string, unknown>[]
}

export function JsonLd({ data }: JsonLdProps) {
  const docs = Array.isArray(data) ? data : [data]
  return (
    <>
      {docs.map((doc, idx) => (
        <script
          // eslint-disable-next-line react/no-array-index-key
          key={idx}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(doc) }}
        />
      ))}
    </>
  )
}
