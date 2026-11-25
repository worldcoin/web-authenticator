// Tailwind class lists shared by more than one screen. Colours and type are Nucleus tokens only.

/** Request screens: the 393 × 852 Figma frame, centered in the browser. */
export const captureFrame = "m-auto flex w-full max-w-[393px] min-h-(--request-frame-min-height) flex-col bg-surface-page";
export const requestFrame = `${captureFrame} px-6 pb-[max(24px,env(safe-area-inset-bottom))]`;
/** The request intro: full-bleed on phones, a card on wider screens. */
export const consentFrame = `${requestFrame} min-[600px]:my-8 min-[600px]:min-h-0 min-[600px]:max-w-120 min-[600px]:rounded-[28px] min-[600px]:border min-[600px]:border-stroke-secondary min-[600px]:px-10 min-[600px]:pb-10`;
export const screenContent = "z-2 flex w-full flex-1 items-center justify-center py-16";
export const centeredLayout = "flex w-full max-w-[345px] flex-col items-center px-2 text-center";
export const messageBlock = "flex w-full flex-col items-center text-center";
const heading = "text-foreground-primary wrap-anywhere focus:outline-none";
export const screenTitle = `${heading} text-h2`;
export const completionTitle = `${heading} text-h3`;
/** Callers choose the colour. */
export const copy = "max-w-[313px] text-b1 wrap-anywhere";
export const body = `${copy} text-foreground-primary`;
/** Callers choose the colour. */
export const detailCopy = `${copy} rounded-xl bg-background-secondary px-3 py-2.5`;
export const errorCopy = `${body} w-full rounded-xl bg-status-error-background p-3`;
export const actions = "z-6 flex w-full flex-[0] flex-col gap-2 empty:hidden md:max-w-100";

