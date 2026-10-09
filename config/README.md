# Authenticator server configuration

`AUTHENTICATOR_HOST` defaults to `127.0.0.1`; `PORT`/`AUTHENTICATOR_PORT` defaults
to 4173. `AUTHENTICATOR_PUBLIC_ORIGIN` defaults to `http://127.0.0.1:<port>` and
`AUTHENTICATOR_LOCAL_ORIGIN` to `http://localhost:<port>`. Origins must be bare
HTTP(S) origins; invalid configuration fails startup.

Security headers apply to all responses. The browser CSP permits only this origin,
the two official World ID bridges and WalletKit's US staging gateway/indexer/OPRF
endpoints. Staging addresses and the WalletKit version are pinned together; review
that allowlist when upgrading the SDK.

Synthetic issuance additionally requires a loopback listener, a loopback request
host and a matching allowed Origin. Binding a container to `0.0.0.0` disables it.
There are no selectable demo scenarios or RP identities in configuration.
