import { buttonStyle } from "../design/buttons";
import { PresenceBadge } from "./PresenceBadge";
import { actions } from "./styles";

export type EndAction = { label: string; href: string };

export function ProcessingStatus({ title, hint, done = false, endAction }: { title: string; hint?: string; done?: boolean; endAction?: EndAction }) {
  return <div className={`absolute inset-0 flex flex-col items-center overflow-y-auto px-6 pb-[max(20px,env(safe-area-inset-bottom))] text-center min-[600px]:px-10 ${done ? "z-50 bg-surface-page" : ""}`}
    data-testid={done ? "all-set" : undefined}>
    <PresenceBadge done={done} title={done ? "You’re all set" : title} hint={done ? "You can close this tab" : hint} />
    {done && <div className={`${actions} mt-auto pt-6`}>
      <a className={`${buttonStyle("primary48")} w-full`} href="/authenticator">Return to authenticator</a>
      {endAction && <a className="block min-h-11 content-center text-b2 text-foreground-primary underline underline-offset-3" href={endAction.href}>{endAction.label}</a>}
    </div>}
  </div>;
}
