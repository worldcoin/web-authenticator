import { signinError, signinHeading, signinLink, signinPage, signinPrimary } from "./styles";

// Copy from world-app-website (World ID, World App, Mini Apps) and the
// developer portal home (World ID for developers).
const apps = [
  { name: "World ID", href: "https://world.org/world-id", text: "A digital proof of human that securely and anonymously proves you are a unique human online." },
  { name: "World App", href: "https://world.org/world-app", text: "Safely store a World ID, exchange digital assets and access Mini Apps." },
  { name: "Mini Apps", href: "https://world.org/ecosystem", text: "Everyday apps optimized for real humans." },
  { name: "Build with World ID", href: "https://docs.world.org/world-id/overview", text: "Verify unique humans while preserving privacy. Add proof of human to your app, platform, or protocol." },
];

/** Home page with no request: what World is, linking out to its apps. */
export function Home({ onOpen, busy = false, error }: { onOpen?: () => void; busy?: boolean; error?: string }) {
  return <div className={signinPage}>
    <section className="flex flex-col items-center gap-7 px-6 pt-24 pb-14 text-center max-sm:gap-6 max-sm:pt-16 max-sm:pb-10">
      <img className="size-22 max-sm:size-18" src="/assets/brand/human-badge.svg" alt="" />
      <h1 className={`${signinHeading} max-w-190 text-[clamp(40px,6vw,72px)] leading-[1.05] tracking-[-0.03em]`}>Download World ID</h1>
    </section>
    <nav className="mx-auto grid w-full max-w-230 grid-cols-2 gap-4 px-6 max-sm:grid-cols-1" aria-label="World apps">
      {apps.map(app => <a key={app.name} className={`group flex min-h-50 flex-col justify-between gap-10 rounded-2xl border border-[#edece9] bg-white p-7 text-ink transition-[border-color] duration-150 ease-[ease] hover:border-[#d6d3cd] motion-reduce:transition-none max-sm:min-h-0 max-sm:gap-6 max-sm:p-6 ${signinLink}`} href={app.href}>
        <span className="flex justify-between gap-4 text-[24px] font-[450] tracking-[-0.02em] max-sm:text-[21px]">{app.name}<span className="text-ink-muted transition-[translate,color] duration-150 ease-[ease] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-ink motion-reduce:transition-none" aria-hidden="true">↗</span></span>
        <span className="max-w-[38ch] text-[16px] leading-[1.45] text-ink-muted">{app.text}</span>
      </a>)}
    </nav>
    <div className="flex flex-col items-center px-6 pt-8 pb-20 max-sm:pb-12">
      {onOpen && <button className={`${signinPrimary} max-w-[345px]`} disabled={busy} onClick={onOpen}><span aria-live="polite">{busy ? "Opening authenticator…" : "Go to authenticator"}</span></button>}
      {error && <p className={signinError} role="alert">{error}</p>}
    </div>
  </div>;
}
