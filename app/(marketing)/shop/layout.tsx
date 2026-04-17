import { ShopCartFab } from "@/components/public/shop/ShopCartFab"

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <ShopCartFab />
    </>
  )
}
