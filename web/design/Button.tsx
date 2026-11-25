import type { ButtonHTMLAttributes } from "react";
import { buttonStyle, disabledStyle, type ButtonStyle } from "./buttons";
import { Spinner } from "./Spinner";

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> & {
  buttonStyle: ButtonStyle;
  /** Keeps the style, hides the label under a spinner and blocks taps, like iOS WLDAction. */
  loading?: boolean;
};

/** A Nucleus button. Disabled switches to the Nucleus disabled style at the same size. */
export function Button({ buttonStyle: style, loading = false, disabled = false, type = "button", className = "", children, ...props }: ButtonProps) {
  const resolved = disabled && !loading ? disabledStyle(style) : style;
  return <button {...props} type={type} disabled={disabled || loading} aria-busy={loading || undefined}
    className={`${buttonStyle(resolved)} disabled:opacity-100 ${loading ? "relative cursor-progress" : ""} ${className}`}>
    {/* Transparent rather than hidden, so the button keeps its width and its accessible name. */}
    <span className={`inline-flex items-center gap-2 ${loading ? "opacity-0" : ""}`}>{children}</span>
    {loading && <Spinner className="absolute" />}
  </button>;
}
