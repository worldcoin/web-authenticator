# Cloudflare releases

| Deployment | Origin | Worker | GitHub environment |
| --- | --- | --- | --- |
| Staging | `https://authenticator.toolsforhumanity.dev` | `web-authenticator-dev` | `staging-cloudflare` |
| Production | `https://web.world.org` | `web-authenticator-prod` | `prod-cloudflare` |

Staging retains its existing Worker name, hostname, Access application, and browser
storage. Renaming the GitHub environment does not recreate the Worker or migrate
user data. The obsolete `cloudflare-dev` GitHub environment can be retired after
checking for remaining consumers and moving any environment-scoped secrets.

The exact browser origin selects the protocol network. WalletKit initialization,
request validation, RP lookup, and registration retry state use that network.
Staging accepts `sandbox` and `staging` requests; production accepts `production`.
Unknown origins fail closed. Localhost uses staging.

## Ownership and state

`worldcoin/infrastructure` manages Workers, Cloudflare SaaS hostname routing, TLS
validation outputs, and GitHub environment protections. This repository owns code,
Wrangler bindings, Workers Builds configuration for staging, and production releases.
The Foundation-owned `world.org` zone needs the DNS records from the infrastructure
output; adding a GitHub environment alone does not publish a website.

Workers have no database, KV, R2, or Durable Object bindings. WalletKit's encrypted
vault and passkey metadata live in the browser, and protocol accounts live in the
selected external network. Releases preserve storage keys and PRF derivation.
Staging passkeys and wallets are not copied to the new production origin. Keep the
production hostname stable after launch; a hostname change needs a separate account
recovery/migration design.

## Initial rollout

1. Confirm `web-authenticator-prod` is not an existing unmanaged Worker before
   creating its bootstrap placeholder. Review and apply the companion infrastructure
   PR through TFE. It creates the
   production Worker placeholder and SaaS hostname, plus `staging-cloudflare` and
   `prod-cloudflare` with main-only branch rules. Production requires Protocol
   approval, prevents self-review, and disables admin bypass. Terraform sets
   `CLOUDFLARE_RELEASE_CONFIGURED=true` only after these protections exist.
2. Make `CLOUDFLARE_API_TOKEN` available to both environments, using an existing
   organization secret where authorized or environment-scoped secrets. Limit it
   to the deployment account and required Worker/Build operations. Production
   must not have a native Workers Builds trigger bypassing its approval gate.
3. Have the Foundation DNS owner publish the CNAME, ownership, and certificate
   validation records from the sensitive TFE output `web_authenticator_prod_dcv`.
   Confirm the custom hostname and TLS certificate are active. The new hostname
   serves a placeholder until the first production release; do not announce it yet.
4. Merge the app PR. Run `Cloudflare configuration` from main in `plan-and-apply`
   mode if it has not run successfully. Workers Builds continues to build, lint,
   typecheck, test, and deploy main to staging, tagging versions with the commit SHA.
5. Review the app on staging, then run the production workflow below. The first
   release candidate must include this deployment configuration.

## Promote to production

1. Confirm the chosen main commit is deployed and works on staging. Authenticate
   through TFH Access and inspect `/api/health/ready` for the expected commit and
   staging network. Retain that commit's staging validation evidence for the approver.
2. Run **Actions → Promote to production → Run workflow**, select `main`, and enter
   the full 40-character commit SHA. The workflow rejects commits outside main's
   history and runs the existing Chromium/WebKit CI suite against that exact commit.
3. A different Protocol reviewer approves `prod-cloudflare`, checking the candidate
   SHA and staging evidence. Staging remains Access-protected; its live functional
   check is manual, not performed by the release workflow. New staging deployments
   do not change the selected production commit.
4. The workflow rebuilds with locked dependencies, deploys that SHA to production,
   and checks the public origin, readiness, protocol, version tag, security headers,
   and browser entry scripts. These checks do not create wallets or biometric data.

Production releases are serialized and never triggered automatically by merging.
A failed post-deploy check fails the workflow but does not automatically roll back;
inspect the failure and use the recovery steps below. Browser artifact uploads remain
disabled. No storage or account migration runs during promotion.

The app does not yet integrate live biometric TEE enrollment. Passing release checks
does not establish Nitro attestation, PCP issuance, or WalletKit PCP import. That
integration needs its own staging end-to-end validation before it can be launched.

## Rollback

For a normal rollback, run the same manual workflow with a previously verified main
commit that includes this configuration. It reruns CI and requires production approval.
For an urgent operator recovery, select a verified version from Wrangler deployment
history, then run `bunx wrangler rollback <version-id> --env production`. Follow with
`bun scripts/smoke-cloudflare.ts production <previous-commit>`. This privileged recovery
path requires the deployment credential and should be recorded in the incident.
Neither approach deletes browser storage or changes the production origin.
