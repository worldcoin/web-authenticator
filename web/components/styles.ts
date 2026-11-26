// Tailwind class lists shared by more than one screen. Colours and type are Nucleus tokens only.

export const captureFrame = "relative flex min-h-full w-full flex-col bg-surface-page";
export const requestFrame = `${captureFrame} px-6 pb-[max(24px,env(safe-area-inset-bottom))] min-[600px]:px-10 min-[600px]:pb-10`;
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

