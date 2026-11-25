import type { IconToken } from "@worldcoin/nucleus";
import icons from "@worldcoin/nucleus/nucleus-icons.json";

/** A Nucleus icon name, e.g. `check`, `xmark`, `presence-emblem`. */
export type IconName = IconToken extends `${infer Name}.${string}` ? Name : never;
export type IconVariant = "regular" | "solid";

const markup = icons as Record<IconName, { svg: Partial<Record<IconVariant, string>> }>;

/**
 * A Nucleus icon, the web counterpart of iOS `Image(icon:variant:)`. It takes the current text
 * colour (set it with `text-*`) and is 24 px unless sized with `size-*`. A missing variant falls
 * back to the other one, as on iOS. Decorative unless `label` is given.
 */
export function Icon({ icon, variant = "regular", label, className = "" }: {
  icon: IconName; variant?: IconVariant; label?: string; className?: string;
}) {
  const { svg } = markup[icon];
  const source = svg[variant] ?? svg[variant === "regular" ? "solid" : "regular"] ?? "";
  // Inline rather than an image or mask: the CSP allows only same-origin images, and Nucleus icons
  // paint with currentColor. The markup is the pinned Nucleus package's, never user input.
  return <span role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}
    data-icon={icon} className={`inline-block shrink-0 [&>svg]:size-full ${defaultSize(className)} ${className}`}
    dangerouslySetInnerHTML={{ __html: source }} />;
}

// Tailwind orders same-property utilities by value, not class order, so a default size-6 would beat
// a caller's size-4. Apply it only when the caller sets no size.
export function defaultSize(className: string): string {
  return /(^|\s)size-/.test(className) ? "" : "size-6";
}
