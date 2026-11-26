import arrowUpRegular from "@worldcoin/nucleus/icons/arrow-up-regular.svg?raw";
import cardCredentialRegular from "@worldcoin/nucleus/icons/card-credential-regular.svg?raw";
import cardCredentialSolid from "@worldcoin/nucleus/icons/card-credential-solid.svg?raw";
import checkRegular from "@worldcoin/nucleus/icons/check-regular.svg?raw";
import ellipsisRegular from "@worldcoin/nucleus/icons/ellipsis-regular.svg?raw";
import humanEmblemRegular from "@worldcoin/nucleus/icons/human-emblem-regular.svg?raw";
import humanEmblemSolid from "@worldcoin/nucleus/icons/human-emblem-solid.svg?raw";
import lockRegular from "@worldcoin/nucleus/icons/lock-regular.svg?raw";
import lockSolid from "@worldcoin/nucleus/icons/lock-solid.svg?raw";
import personCircleRegular from "@worldcoin/nucleus/icons/person-circle-regular.svg?raw";
import personCircleSolid from "@worldcoin/nucleus/icons/person-circle-solid.svg?raw";
import personKeyRegular from "@worldcoin/nucleus/icons/person-key-regular.svg?raw";
import plusRegular from "@worldcoin/nucleus/icons/plus-regular.svg?raw";
import presenceEmblemRegular from "@worldcoin/nucleus/icons/presence-emblem-regular.svg?raw";
import xmarkRegular from "@worldcoin/nucleus/icons/xmark-regular.svg?raw";

const markup = {
  "arrow-up": { regular: arrowUpRegular },
  "card-credential": { regular: cardCredentialRegular, solid: cardCredentialSolid },
  check: { regular: checkRegular },
  ellipsis: { regular: ellipsisRegular },
  "human-emblem": { regular: humanEmblemRegular, solid: humanEmblemSolid },
  lock: { regular: lockRegular, solid: lockSolid },
  "person-circle": { regular: personCircleRegular, solid: personCircleSolid },
  "person-key": { regular: personKeyRegular },
  plus: { regular: plusRegular },
  "presence-emblem": { regular: presenceEmblemRegular },
  xmark: { regular: xmarkRegular },
};

export type IconName = keyof typeof markup;
export type IconVariant = "regular" | "solid";

/**
 * A Nucleus icon, the web counterpart of iOS `Image(icon:variant:)`. It takes the current text
 * colour (set it with `text-*`) and is 24 px unless sized with `size-*`. A missing variant falls
 * back to the other one, as on iOS. Decorative unless `label` is given.
 */
export function Icon({ icon, variant = "regular", label, className = "" }: {
  icon: IconName; variant?: IconVariant; label?: string; className?: string;
}) {
  const svg = markup[icon];
  const source = variant === "solid" && "solid" in svg ? svg.solid : svg.regular;
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
