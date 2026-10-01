import { VariantSwitcher, useVariant, type Variant } from "@/components/site/variant-switcher"

import { GuestGate } from "./gate"
import { GuestGuide } from "./guide"
import { GuestLetter } from "./letter"

// Prototype: three guest landing pages for "/", switchable via ?variant=a|b|c on the same route.
// None of them shows posters or lists the catalogue.

const VARIANTS: (Variant & { Component: () => React.ReactNode })[] = [
  { key: "a", name: "舱门", Component: GuestGate },
  { key: "b", name: "登舰指南", Component: GuestGuide },
  { key: "c", name: "站长来信", Component: GuestLetter },
]

export function GuestHomePage() {
  const variant = useVariant(VARIANTS)
  return (
    <>
      <variant.Component key={variant.key} />
      <VariantSwitcher variants={VARIANTS} current={variant} />
    </>
  )
}
