// Tailwind class lists shared by more than one screen.

/** Request screens: the 393 × 852 Figma frame, centered in the browser. */
export const captureFrame = "m-auto flex w-full max-w-[393px] min-h-(--request-frame-min-height) flex-col bg-white";
export const requestFrame = `${captureFrame} px-6 pb-[max(24px,env(safe-area-inset-bottom))]`;
export const screenContent = "z-2 flex w-full flex-1 items-center justify-center py-16";
export const centeredLayout = "flex w-full max-w-[345px] flex-col items-center px-2 text-center";
export const messageBlock = "flex w-full flex-col items-center text-center";
const heading = "font-normal leading-[1.2] text-foreground wrap-anywhere focus:outline-none";
export const screenTitle = `${heading} text-[27px] tracking-[-0.405px]`;
export const completionTitle = `${heading} text-[24px] tracking-[-0.36px]`;
/** Callers choose the size and colour. */
export const copy = "max-w-[313px] font-[350] leading-[1.3] tracking-[-0.085px] wrap-anywhere";
export const body = `${copy} text-[17px] text-foreground`;
/** Callers choose the colour. */
export const detailCopy = `${copy} rounded-xl bg-background-secondary px-3 py-2.5 text-[17px]`;
export const errorCopy = `${body} w-full rounded-xl bg-[#fff1f1] p-3`;
export const actions = "z-6 flex w-full flex-[0] flex-col gap-2 empty:hidden md:max-w-100";

const action = "w-full min-h-12 rounded-3xl border px-6 py-3 text-[17px] font-medium leading-[1.2] tracking-[-0.17px]";
export const primaryAction = `${action} border-foreground bg-foreground text-white`;
export const secondaryAction = `${action} border-[#d8d8d8] bg-white text-foreground`;
export const returnLink = "block text-center focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-accent";

/** Sign-in, consent and home screens. */
export const signinPage = "flex w-full flex-1 flex-col text-ink";
const signinFocus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue";
const signinAction = `flex w-full min-h-[52px] items-center justify-center rounded-full px-6 text-[16px] font-medium transition-[background-color] duration-120 ease-[ease] ${signinFocus}`;
export const signinPrimary = `${signinAction} gap-2.5 bg-ink text-white enabled:hover:bg-[#333]`;
export const signinSecondary = `${signinAction} border border-line bg-white text-ink enabled:hover:bg-[#f1f0ee]`;
export const signinHeading = "font-[450] text-ink focus:outline-none";
export const signinError = "mt-4 rounded-2xl border border-[#f3c7c7] bg-[#fff6f6] px-4 py-3 text-[14px] leading-[1.5] text-[#a32424]";
export const signinLink = signinFocus;
