import { useEffect, useRef, useState, type ReactNode } from "react";
import { menuItem } from "./styles";

const PRIVACY_URL = "https://www.toolsforhumanity.com/legal/privacy-notice";

/** Shared chrome stays mounted while the current screen changes. */
export function AppLayout({ menuItems, hideControls = false, tintedBackground = false, children }: {
  menuItems: (close: () => void) => ReactNode;
  hideControls?: boolean;
  tintedBackground?: boolean;
  children: ReactNode;
}) {
  return <div className="flex min-h-dvh flex-col bg-white">
    <main className={`relative flex w-full min-w-0 min-h-0 flex-1 flex-col overflow-x-clip min-[600px]:justify-center ${tintedBackground ? "bg-[#e8ecf2]" : "bg-white"}`}>{children}</main>
    {!hideControls && <WorldMenu menuItems={menuItems} />}
  </div>;
}

function WorldMenu({ menuItems }: { menuItems: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div ref={menu} className="fixed right-[max(16px,env(safe-area-inset-right))] bottom-[max(16px,env(safe-area-inset-bottom))] z-30">
      <button ref={trigger} type="button" aria-label="Menu" aria-expanded={open} aria-controls={open ? "world-menu" : undefined} className="grid size-12 place-items-center rounded-full border border-[#c3cddb] bg-white text-[#0d1421] shadow-[0_4px_16px_rgba(13,20,33,.12)] hover:bg-[#f2f6fc]" onClick={() => setOpen(value => !value)}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
      </button>
      {open && <nav id="world-menu" aria-label="World links" className="absolute right-0 bottom-[60px] w-56 rounded-xl border border-[#d6dde7] bg-white p-2 shadow-[0_12px_32px_rgba(13,20,33,.18)]">
        <a className={menuItem} onClick={() => setOpen(false)} href="https://world.org/world-id">World ID</a>
        <a className={menuItem} onClick={() => setOpen(false)} href="https://world.org/world-app">World App</a>
        <a className={menuItem} onClick={() => setOpen(false)} href="https://world.org/ecosystem">Mini Apps</a>
        <a className={menuItem} onClick={() => setOpen(false)} href="https://docs.world.org/world-id/overview">Build with World ID</a>
        <a className={menuItem} onClick={() => setOpen(false)} href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">Privacy</a>
        {menuItems(() => setOpen(false))}
      </nav>}
    </div>;
}
