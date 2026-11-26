import type { ReactNode } from "react";
import { WorldMenu } from "./WorldMenu";

/** Shared chrome stays mounted while the current screen changes. */
export function AppLayout({ onCookieSettings, hideControls = false, children }: {
  onCookieSettings?: () => void;
  hideControls?: boolean;
  children: ReactNode;
}) {
  return <div className="grid min-h-svh place-items-center bg-surface-page">
    <main className="experience-frame relative isolate flex w-full flex-col overflow-y-auto bg-surface-page min-[600px]:max-w-120 min-[600px]:rounded-[28px] min-[600px]:border min-[600px]:border-stroke-secondary">{children}</main>
    {!hideControls && <WorldMenu onCookieSettings={onCookieSettings} />}
  </div>;
}
