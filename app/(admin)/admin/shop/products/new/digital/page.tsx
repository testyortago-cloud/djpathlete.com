// app/(admin)/admin/shop/products/new/digital/page.tsx
import { DigitalProductForm } from "./DigitalProductForm"

export default function NewDigitalProductPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 font-heading text-2xl">New digital product</h1>
      <DigitalProductForm />
    </div>
  )
}
