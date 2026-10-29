# Models

RGBNet comes from Tools for Humanity's private [rgb-net repository](https://github.com/worldcoin/rgb-net).
Model binaries are excluded from Git. `bun run build:cf` downloads the pinned
model from the public Face Engine bucket in `web/lib/rgbnet-model.json` and
verifies its size and SHA-256. Set `AUTHENTICATOR_RGBNET_PATH` to use a local copy.
