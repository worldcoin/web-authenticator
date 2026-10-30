# Public Cloudflare releases

| Deployment | Origin | Worker | Protocol network |
| --- | --- | --- | --- |
| Sandbox (staging gate) | `https://web.sandbox.world.org` | `web-authenticator-sandbox` | staging |
| Production | `https://web.world.org` | `web-authenticator-prod` | production |
| Internal demo | `https://authenticator.toolsforhumanity.dev` | `web-authenticator-dev` | staging |

The browser selects its network from the exact site origin. WalletKit initialization,
request environment validation, RP lookup, and registration retry state use that
network. Sandbox accepts `sandbox` and `staging` requests; production accepts only
`production`. Passkeys remain scoped to each hostname; sandbox wallets do not migrate
to production.

The `Cloudflare release` workflow reuses the existing Chromium/WebKit CI checks for
a main commit, deploys sandbox, and checks
its readiness, JavaScript assets, security headers, network, origin, and version tag.
Production requires the protected `cloudflare-production` environment approval. It
rechecks sandbox after approval and rebuilds/deploys the same immutable commit with
the locked dependencies. The complete pipeline is serialized. Browser artifact uploads
remain disabled. Internal Workers Builds continues to deploy dev independently.

## Initial rollout

1. Apply the companion infrastructure PR through TFE. It creates the two Worker
   placeholders, cross-account SaaS hostnames, and main-only GitHub environments;
   Protocol is the production reviewer team and admin bypass is disabled. Terraform
   enables `CLOUDFLARE_RELEASE_CONFIGURED` only after those protections exist;
   until then the release workflow is skipped.
2. Publish the CNAME, ownership, and certificate-validation records from the TFE
   `web_authenticator_public_dcv` output in the Foundation-owned DNS zone. Confirm
   both hostnames and certificates are active before the first release.
3. Make the existing deployment credential available as `CLOUDFLARE_API_TOKEN` to
   the two protected environments (or use the existing organization secret if it
   grants this repository access). Limit it to the deployment account/Workers.
4. Merge this PR and run the pipeline from main. Review sandbox before approving
   production. These smoke checks do not create users or submit biometric data.

The current main app has no live biometrics TEE enrollment integration. A successful
release check confirms the web deployment, not Nitro attestation, PCP issuance, or
WalletKit PCP import. The TEE/signup/reader work must add its real staging end-to-end
check before presenting biometric enrollment as production-ready.

## Rollback

Use Wrangler's deployment history to select the previously verified version for
`web-authenticator-prod`, then `bunx wrangler rollback <version-id> --env production`.
Run `bun scripts/smoke-cloudflare.ts production <previous-commit>` afterward. Keep
sandbox on that commit when promoting a rollback through the normal pipeline.
