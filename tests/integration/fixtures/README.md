# Synthetic fixture policy

W09 automated evidence uses generated metadata and SHA-256-shaped digests only.
No person image, video, audio, passkey, credential, signature, private key,
device identifier, or raw timing trace is a committed fixture.

The product's allowlisted `fixture-neutral-v0` identifier is exercised by the
full clean-start suite. W09's app-composition flow uses `metadata_only`, so it
does not need or imply a camera image.
