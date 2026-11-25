import type { ReactNode } from "react";
import { WorldMenu } from "./WorldMenu";

/** Shared chrome stays mounted while the current screen changes. */
export function AppLayout({ onCookieSettings, hideControls = false, tintedBackground = false, children }: {
  onCookieSettings?: () => void;
  hideControls?: boolean;
  tintedBackground?: boolean;
  children: ReactNode;
}) {
  return <div className="flex min-h-dvh flex-col bg-surface-page">
    <main className={`relative flex w-full min-w-0 min-h-0 flex-1 flex-col overflow-x-clip min-[600px]:justify-center ${tintedBackground ? "bg-background-secondary" : "bg-surface-page"}`}>{children}</main>
    {!hideControls && <WorldMenu onCookieSettings={onCookieSettings} />}
  </div>;
}
