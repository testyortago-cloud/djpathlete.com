import "@testing-library/jest-dom/vitest"
import { vi } from "vitest"

// Default no-op mock for Resend so tests that forget vi.mock("resend", ...)
// cannot hit the live API. Per-file vi.mock("resend", ...) still wins.
vi.mock("resend", () => ({
  // Use a regular function (not an arrow) so `new Resend()` in lib/resend.ts is
  // constructable — arrow functions can't be used with `new`.
  Resend: vi.fn(function () {
    return {
      emails: {
        send: vi.fn().mockResolvedValue({ data: { id: "test-email" }, error: null }),
      },
    }
  }),
}))

// revalidatePath / revalidateTag need Next's request store; no-op them so route
// handlers invoked directly in tests don't throw "static generation store missing".
vi.mock("next/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/cache")>()
  return {
    ...actual,
    revalidatePath: vi.fn(),
    revalidateTag: vi.fn(),
  }
})

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}))

// Mock next/image
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    const { fill, priority, ...rest } = props
    return <img {...rest} />
  },
}))
