import type { ReactNode } from "react";
import { SiteFooter } from "./SigninPage";

// Copy from world-app-website (World ID, World App, Mini Apps) and the
// developer portal home (World ID for developers).
const apps = [
  { name: "World ID", href: "https://world.org/world-id", text: "A digital proof of human that securely and anonymously proves you are a unique human online." },
  { name: "World App", href: "https://world.org/world-app", text: "Safely store a World ID, exchange digital assets and access Mini Apps." },
  { name: "Mini Apps", href: "https://world.org/ecosystem", text: "Everyday apps optimized for real humans." },
  { name: "Build with World ID", href: "https://docs.world.org/world-id/overview", text: "Verify unique humans while preserving privacy. Add proof of human to your app, platform, or protocol." },
];

/** Home page with no request: what World is, linking out to its apps. */
export function Home({ footerActions }: { footerActions: ReactNode }) {
  return <div className="signin home">
    <section className="home-hero">
      <img className="home-badge" src="/assets/brand/human-badge.svg" alt="" />
      <h1>Prove you’re human, anywhere online</h1>
    </section>
    <nav className="home-apps" aria-label="World apps">
      {apps.map(app => <a key={app.name} className="home-card" href={app.href}>
        <span className="home-card-title">{app.name}<span className="home-card-arrow" aria-hidden="true">↗</span></span>
        <span className="home-card-text">{app.text}</span>
      </a>)}
    </nav>
    <SiteFooter footerActions={footerActions} />
  </div>;
}
