# Contributing to PromptWise

Thanks for your interest in improving PromptWise! This project is intentionally
**zero-dependency** and **no-build** — plain JavaScript that runs in Node and the
browser as-is. Please keep it that way unless there's a compelling reason.

## Getting started

```bash
git clone https://github.com/Nirupam014/promptwise.git
cd promptwise
npm test          # runs the core test suite (no install needed)
```

There is nothing to compile. The shared engine lives in `packages/core/src` and
every surface (CLI, browser extension, VS Code extension) is a thin adapter over
it.

## Project layout

| Path | What it is |
|------|------------|
| `packages/core` | the shared engine (rewrite, flood, memory, persona) + tests |
| `packages/cli` | command-line adapter |
| `packages/browser-extension` | MV3 extension (ChatGPT/Claude/Gemini) |
| `packages/vscode-extension` | IDE adapter |
| `scripts/sync-core.js` | copies the engine into the extensions' `vendor/core` |

## The vendored engine

The browser and VS Code extensions must be loadable/standalone, so they ship a
**copy** of the engine under `vendor/core`. After changing anything in
`packages/core/src`, re-sync the copies:

```bash
npm run sync-core      # update the vendored copies
npm run check-core     # CI runs this; fails if copies are stale
```

CI will reject a PR whose vendored copies drift from the source.

## Lint & format

```bash
npm run lint          # eslint
npm run format        # prettier --write
npm run format:check  # prettier --check (CI runs this)
```

These need dev tooling installed (`npm install`). The runtime packages stay
zero-dependency; eslint/prettier are dev-only.

## Making changes

1. **Add a test.** Anything touching the engine needs coverage in
   `packages/core/test`. Run `npm test`.
2. **Keep rewrites safe.** The engine must never produce a longer prompt, must
   preserve code/URLs/numbers, and must err toward under-trimming. New transforms
   should be meaning-preserving.
3. **No new runtime dependencies** in `core`, `cli`, or the extensions.
4. **Run `npm run check-core`** if you touched the engine.

## Commit & PR

- Use clear, imperative commit messages (e.g. `rewrite: drop "in advance" filler`).
- Conventional Commits are welcome but not required.
- Fill out the PR template; link any related issue.
- Be kind in review. See our [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting bugs / ideas

Open an issue using the templates. For security issues, see
[SECURITY.md](SECURITY.md) — please don't file public issues for vulnerabilities.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
