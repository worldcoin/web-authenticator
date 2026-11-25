import type { ButtonStyleToken } from "@worldcoin/nucleus";

/**
 * Nucleus button styles, the web counterpart of iOS `.wldButtonStyle(.primary48)`.
 * Apply to a `<button>` or a link styled as one; use `Button` for loading and disabled states.
 */
export type ButtonStyle = ButtonStyleToken extends infer Token
  ? Token extends `${infer Variant}.${infer Size}` ? `${Variant}${Size}` : never
  : never;

type Variant = ButtonStyleToken extends `${infer V}.${string}` ? V : never;
type Size = ButtonStyleToken extends `${string}.${infer S}` ? S : never;

// Nucleus pressed state: opacity 0.7 and a scale of 1 - pressedInset / 65.
const base = "inline-flex items-center justify-center gap-2 rounded-full text-center select-none " +
  "transition-[opacity,scale] duration-100 enabled:active:scale-[0.985] enabled:active:opacity-70 " +
  "focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-accent-blue";

const variants: Record<Variant, string> = {
  primary: "bg-background-inverse text-foreground-inverse",
  secondary: "bg-background-secondary text-foreground-primary",
  tertiary: "border border-stroke-secondary bg-background-primary text-foreground-primary",
  inverse: "bg-background-primary text-foreground-primary",
  ghost: "bg-background-transparent text-foreground-primary",
  disabled: "bg-background-disabled text-foreground-disabled cursor-not-allowed",
};

// Heights are minimums so labels can wrap at large text sizes.
const sizes: Record<Size, string> = {
  "32": "min-h-8 px-3.5 py-2 text-l3",
  "40": "min-h-10 px-5 py-[11px] text-l2",
  "48": "min-h-12 px-6 py-3.5 text-l1",
};

// Icon-only buttons are circles of the button's height.
const iconSizes: Record<Size, string> = { "32": "size-8", "40": "size-10", "48": "size-12" };

export function buttonStyle(style: ButtonStyle): string {
  const [variant, size] = parse(style);
  return `${base} ${variants[variant]} ${sizes[size]}`;
}

/** A circular button holding only an `Icon`; give it an `aria-label`. */
export function iconButtonStyle(style: ButtonStyle): string {
  const [variant, size] = parse(style);
  return `${base} ${variants[variant]} ${iconSizes[size]}`;
}

function parse(style: ButtonStyle): [Variant, Size] {
  const [, variant, size] = /^([a-z]+)(\d+)$/.exec(style) as unknown as [string, Variant, Size];
  return [variant, size];
}

/** The disabled style at the same size, as iOS WLDAction swaps to `.disabled48`. */
export function disabledStyle(style: ButtonStyle): ButtonStyle {
  return `disabled${style.replace(/^[a-z]+/, "")}` as ButtonStyle;
}
