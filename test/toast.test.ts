import { expect, it, vi } from "vitest";
import { mergeProps } from "@base-ui/react/merge-props";
import type { ReactElement } from "react";
import { ToastList } from "@/components/ui/toast";

const toasts = vi.hoisted(() => [{ id: "sticky", data: { dismissible: false } }, { id: "dismissible" }]);
vi.mock("@base-ui/react/toast", async original => {
  const base = await original<typeof import("@base-ui/react/toast")>();
  return { ...base, Toast: { ...base.Toast, useToastManager: () => ({ toasts }) } };
});

// ToastRoot puts its own Escape-to-close handler first and merges the element's props after it with mergeProps.
const escapeCloses = (toast: ReactElement<{ onKeyDown?: () => void }>) => {
  const close = vi.fn();
  mergeProps<"div">({ onKeyDown: close }, { onKeyDown: toast.props.onKeyDown }).onKeyDown?.({ key: "Escape", nativeEvent: {} } as never);
  return close.mock.calls.length > 0;
};

it("keeps a focused undismissible toast on Escape and lets other toasts close", () => {
  const [sticky, dismissible] = ToastList() as ReactElement<{ onKeyDown?: () => void }>[];
  expect(escapeCloses(sticky)).toBe(false);
  expect(escapeCloses(dismissible)).toBe(true);
});
