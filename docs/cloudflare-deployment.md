# Internal Cloudflare deployment

This deployment serves the authenticator on a public HTTPS address with TFH login
required for pages, APIs, models and WASM. It tracks `main` using Workers Builds.
It needs no application container, R2 bucket, database, VPN or tunnel.

Status: repository implementation prepared; **no remote resources have been
created or inspected, and no deployment has been published**. Cloudflare account
access is unavailable in this session. The TFH account ID in
`cf-worker-config.json` comes from the shared tool's documented TFH deployment;
an administrator must confirm the account before applying it.

## What main was missing

Audited `worldcoin/web-authenticator` main at
`c703779752484c570af9380ff1681f4889cb2923` on October 26, 2026.

| Piece | Main before this change | Prepared here |
| --- | --- | --- |
| Continuous CI | Tests, lint, types, build, browser checks and container smoke tests already run on main/PRs | Added a Workers deployment dry run on Linux |
| Workers server | Bun.serve, Bun.file and filesystem-based static serving | `api/worker.ts` reuses portable API handlers and security headers; static assets use the ASSETS binding |
| Runtime/deployment config | No Wrangler config or dependency | Pinned Wrangler, generated types, `wrangler.jsonc` and deployment scripts |
| Large WASM delivery | WalletKit emits one oversized file | Build-time gzip compression and delivery at the original URL |
| TFH login | No Cloudflare Access integration | Signed Access-token verification before every route and asset; rejects requests until configured |
| Automatic deployment | CI validates code but never deploys it | `cf-worker-config.json` connects Workers Builds to main; a pinned shared GitHub action reconciles it |
| RGBNet in a clean build | Model binary is excluded from Git; no model provisioning in CI | Deployment build requires a source and verifies the existing pinned byte length and SHA-256 |

Remote Worker, Access policies, GitHub environment secrets, build tokens and
repository installation permissions remain unverified. Missing repository
configuration does not prove those account resources are absent.

## WASM limit and chosen solution

[Workers static assets](https://developers.cloudflare.com/workers/platform/limits/)
have a 25 MiB per-file upload limit on both Free and Paid plans. A normal paid
upgrade does not fix it. This is **not an R2 limit**:
[R2 supports much larger objects](https://developers.cloudflare.com/r2/platform/limits/),
so serving the intact file from a private R2 bucket through the authenticated
Worker is also viable. That would add a bucket, binding, upload permissions and
an asset upload/retention step.

Measured from a fresh web build with the repository's pinned dependencies:

| Asset | Bytes | Static upload |
| --- | ---: | --- |
| WalletKit WASM | 41,632,785 (39.7 MiB) | Too large |
| WalletKit WASM, gzip level 9 | 24,468,814 (23.3 MiB) | Fits |
| ONNX Runtime WASM | 14,239,897 (13.6 MiB) | Fits |
| Pinned RGBNet model | 1,720,022 | Fits; not tracked in Git |

`scripts/build-cloudflare.ts` copies the web build into
`.artifacts/cloudflare/assets`, gzip-compresses oversized WASM at level 9 and
removes the oversized copy from that deployment directory. The ordinary Bun
web build keeps the original WASM. Each compressed file must also fit below
25 MiB; the build fails if a dependency update grows beyond that limit. R2 or
reducing the binary size would then be required.

The Worker serves the gzip file at the original Vite-generated WASM URL with
`Content-Type: application/wasm` and `Content-Encoding: gzip`. Browsers decompress
it automatically and WalletKit loads the same module. The response uses
[encodeBody: manual](https://developers.cloudflare.com/workers/runtime-apis/response/)
to prevent the runtime from compressing already compressed bytes again.
Clients that do not accept gzip receive a streaming decompression fallback;
responses vary by `Accept-Encoding`. Clients that reject both gzip and identity
receive 406. The stored gzip URL is internal to the Worker and missing WASM
returns 404. Range requests receive the complete file with 200; partial
download/resume is not implemented. The original Vite content hash in the URL
and its compressed file are deployed with each Worker version.

## One-time administrator setup

This is the part someone with TFH Cloudflare access must perform. The app owner
does not need their own Cloudflare login for future deployments.

1. Confirm the TFH Cloudflare account and create/confirm the
   `web-authenticator-dev` Worker. Use its assigned `workers.dev` HTTPS hostname
   initially; a custom domain is optional. Keep the authenticator inaccessible
   until Access is enabled (the initial Worker returns 503 while unconfigured).
2. Enable [Access for this Worker's **All traffic**](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).
   Reuse the TFH Okta policy/group for **Team All**, or create an equivalent
   policy using the existing TFH IdP. Do not select Cloudflare-account-members
   as a substitute: employees need TFH SSO, not Cloudflare membership. This
   policy must protect the whole Worker, including APIs and assets. Confirm
   there are no more-specific hostname/path policies that widen access.
3. Put the Access team hostname (without `https://`) and application audience
   tag in `wrangler.jsonc` as `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`.
   They are identifiers, not credentials. Keep the group restriction in the
   Access policy; the Worker verifies signature, issuer, audience and expiry.
   Previews are disabled in both Wrangler and Workers Builds.
4. Provide a stable, private model download source as the GitHub environment
   secret `AUTHENTICATOR_RGBNET_URL`. It must return the pinned RGBNet bytes over
   HTTPS without a redirect, and remain usable on future main builds. If using
   an expiring signed URL, arrange renewal; otherwise later deploys will fail.
   The script also accepts `AUTHENTICATOR_RGBNET_PATH` for local builds. Model
   binaries and download credentials must remain out of Git.
5. Create the GitHub environment `cloudflare-dev` in
   `worldcoin/web-authenticator`. Supply `CLOUDFLARE_API_TOKEN`,
   `GIT_HUB_TOKEN` and `AUTHENTICATOR_RGBNET_URL` there. The shared tool requires
   a **user-scoped** Cloudflare token with Workers Builds Configuration edit
   and Workers Scripts read/edit. Its GitHub token must read the private
   `worldcoin/cf-worker-config` repository and the authenticator's repository
   metadata. Ensure GitHub Actions can use `worldcoin/gh-actions` and Cloudflare's
   GitHub installation can read `worldcoin/web-authenticator`.
6. Ensure Workers Builds has a deployment token for this Worker with Workers
   deployment permissions. This is distinct from the configuration reconciler
   token. If multiple Builds tokens exist, set `build_token_uuid` or
   `build_token_name` in `cf-worker-config.json`; the reconciler deliberately
   refuses an ambiguous choice.
7. Merge the repository changes into main, then run **Cloudflare configuration**
   in `plan` mode, inspect its output, and run `plan-and-apply`. The workflow
   also applies when its config changes on main. The shared action queues a
   main build after reconciliation. Subsequent main pushes trigger Workers
   Builds directly. No second per-commit GitHub deployment job is needed.
8. Test in a signed-out browser that pages, `/verify`, APIs, WASM and models
   require login; check that an unauthorized identity is denied. Sign in with
   TFH Okta and verify consent, request links, WalletKit initialization and real
   RGBNet loading. Confirm non-main pushes do not deploy or create previews.

The existing TFH website uses Okta `Team All` in
[`infrastructure/domains/toolsforhumanity-dev-website.tf`](https://github.com/worldcoin/infrastructure/blob/main/domains/toolsforhumanity-dev-website.tf).
This is evidence for the policy pattern, not proof that this new Worker already
has it configured. An administrator can use the dashboard/API or the existing
infrastructure modules for the small bootstrap; no infrastructure PR has been
opened by this change.

The shared [cf-worker-config tool](https://github.com/worldcoin/cf-worker-config)
manages repo connections, build triggers, build variables/secrets and deliberate
runtime-secret synchronization. It does **not** provision the Worker, DNS,
Access policy or storage. Its `apply` command syncs build secrets; runtime
secrets require a separate command. This deployment needs no runtime secrets.

## Build and validation

```sh
bun install --frozen-lockfile
# Set AUTHENTICATOR_RGBNET_PATH or AUTHENTICATOR_RGBNET_URL in the environment.
bun run build:cf
bun run lint
bun run typecheck
bun run test
bun run cf:check
```

`build:cf` requires the pinned model and fails before building if it cannot
install/verify it. `cf:package` only packages an existing `web/dist` for CI
validation; it intentionally does not certify that the model is present.
Workers Builds runs build:cf, lint, types and unit/integration tests before
deploying. Browser regression tests remain in GitHub CI; configure main's merge
rules to require that CI if deployments must only contain browser-validated
commits. Workers Builds does not wait for the separate GitHub CI run.

Agent-run validation:

- Fresh web build with the existing local pinned RGBNet model; lint and all
  TypeScript checks passed.
- 113 unit/integration tests passed, including signed, expired, wrong-audience,
  wrong-issuer and malformed JWTs; protected asset/API routes; consent limits;
  gzip/identity delivery, HEAD, missing files and compressed upload size limits.
- Wrangler deployment dry run passed; the Worker is about 145 KiB gzipped.
- In local workerd, the 24,468,814-byte gzip asset decoded to the original
  41,632,785-byte WASM with matching SHA-256. Chromium compiled it using
  `WebAssembly.compileStreaming` (570 exports). The identity fallback also
  returned the original bytes. The production handler was separately verified
  to block assets with 503 while Access was unconfigured.
- Two existing Chromium browser checks passed against the local Worker: landing
  does not start the camera, and real RGBNet rejects a faceless stream. These
  used a temporary local harness that bypassed login to isolate runtime and
  asset delivery. They do not validate TFH SSO.

Live SSO, Cloudflare repository linkage, credentials, remote deployment and the
full remote browser flow still require administrator setup. No user-reported
validation has been claimed.

## Operational boundaries

Keep the internal hostname stable: passkeys and saved browser state are scoped
to the origin and do not move automatically to a later custom domain. This is
an internal testing deployment, not a production migration.

Rollback via Cloudflare Workers deployments to a previous version; its compressed
static assets travel with that version. There is no independently updated R2
object to roll back. Access stays enabled during rollback.

The model worker uses `credentials: same-origin` so its same-origin download
carries the Access session. It sends no credentials to another origin. Worker
invocation logs are disabled to avoid adding request URLs containing connector
keys to application logs; errors retain the existing sanitized API responses.
