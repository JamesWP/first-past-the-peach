# First Past the Peach

A web app for two people to collaboratively rank baby names through pairwise comparison.

Each session presents two names — pick the one you prefer. Over many rounds an ELO scoring system builds a ranked list reflecting your shared taste. Results persist across devices via cloud storage.

**Live site:** https://jameswp.github.io/first-past-the-peach/

## How it works

- Runs entirely in the browser — no server-side logic
- SQL database compiled to WASM ([database](https://github.com/JamesWP/database))
- Votes stored in a SQLite blob in S3-compatible cloud storage (planned)
- ELO scores recomputed on demand from the vote log

## Development

```sh
make vendor   # clone, compile, and extract the WASM database package
make serve    # serve on http://localhost:8080
```

Requires `wasm-pack` and a Rust toolchain with the `wasm32-unknown-unknown` target for `make vendor`. The `vendor/` directory is committed so the site works without a local Rust setup.
