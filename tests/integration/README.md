# Integration evidence

This directory contains W09's synthetic-only evidence for the clean-start staging
simulator. It tests the product revision named in `reports/evidence-report.md`.

- `contract/` exercises the frozen state/action contract, browser admission,
  controller composition, the HTTP boundary, session binding/replay behavior,
  and all 4 biometric x 3 issuance scenarios through the real W06/W10 services.
- `privacy/` scans browser-visible projections and source/fixture surfaces for
  forbidden persistence, raw media, private material, and production claims.
- `browser/` runs the built app in the separately named Chromium and desktop
  WebKit Playwright projects. These are desktop synthetic results, not iPhone
  results.
- `device-lab/` is the physical-iPhone runbook, schema, and explicit unexecuted
  matrix. No participant biometric media is accepted or committed.
- `reports/` contains the evidence boundary and reproducible command record.

Playwright trace and video are disabled by the Main-owned configuration.
