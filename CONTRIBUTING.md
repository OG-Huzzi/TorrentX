# Contributing

## Development

```bash
npm install
npm run dev -- search ubuntu --mobile
npm run check
```

Node.js 22 or newer is required. Runtime dependencies must be pure JavaScript and install cleanly on Windows, macOS, Linux, and Android/Termux ARM devices.

`npm run check` runs the TypeScript compiler, ESLint, the Vitest suite, and the build. Coverage thresholds are enforced via `npm run test:coverage` in CI.

## Source adapters

Adapters belong in `src/sources/` and must:

- implement `SourceAdapter`
- use `HttpClient`
- return normalized results through `createResult`
- honor the provided abort signal
- return an empty array for unsupported media types
- avoid global mutable state
- include parser tests when markup or XML shape is non-trivial
- pass `isEmpty` to `raceMirrors` so a blank/blocked mirror page cannot win the race
- register mirror domains in `src/sources/mirrors.ts` (the single source of truth shared with DNS warmup)

Register stable defaults in `src/sources/index.ts`. Keep source-specific parsing out of the search engine. Export the pure mapping/parse function so `tests/adapter-parsers.test.ts` can cover it with fixtures.

Note: `scripts/patch-webtorrent.mjs` patches a null-piece crash in webtorrent after install. The webtorrent version is pinned exactly — when bumping it, re-verify the patch strings and the runtime markers in `src/services/download-engine.ts`.

## Pull requests

Keep changes scoped and include tests for ranking, filtering, query inference, or parser behavior when those surfaces change. Run:

```bash
npm run check
```
