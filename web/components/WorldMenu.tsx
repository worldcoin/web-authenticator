import { useEffect, useRef, useState } from "react";
import { iconButtonStyle } from "../design/buttons";
import { Icon } from "../design/Icon";

const PRIVACY_URL = "https://www.toolsforhumanity.com/legal/privacy-notice";
const menuItem = "block rounded-lg px-4 py-2 text-b2 text-foreground-primary hover:bg-background-secondary focus-visible:outline-2 focus-visible:outline-accent-blue";

export function WorldMenu({ onCookieSettings }: { onCookieSettings?: () => void }) {
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
      <button ref={trigger} type="button" aria-label="Menu" aria-expanded={open} aria-controls={open ? "world-menu" : undefined} className={`${iconButtonStyle("tertiary40")} shadow-[0_4px_16px_color-mix(in_srgb,var(--color-foreground-primary)_12%,transparent)]`} onClick={() => setOpen(value => !value)}>
        <Icon icon="ellipsis" />
      </button>
      {open && <nav id="world-menu" aria-label="World links" className="absolute right-0 bottom-13 w-56 rounded-xl border border-stroke-secondary bg-background-primary p-2 shadow-[0_12px_32px_color-mix(in_srgb,var(--color-foreground-primary)_18%,transparent)]">
        <a className={menuItem} onClick={() => setOpen(false)} href="https://world.org/world-id">World ID</a>
        <a className={menuItem} onClick={() => setOpen(false)} href="https://world.org/world-app">World App</a>
        <a className={menuItem} onClick={() => setOpen(false)} href="https://world.org/ecosystem">Mini Apps</a>
        <a className={menuItem} onClick={() => setOpen(false)} href="https://docs.world.org/world-id/overview">Build with World ID</a>
        <a className={menuItem} onClick={() => setOpen(false)} href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">Privacy</a>
        {onCookieSettings && <button className={`${menuItem} w-full text-left`} onClick={() => { setOpen(false); onCookieSettings(); }}>Cookie settings</button>}
      </nav>}
    </div>;
}
