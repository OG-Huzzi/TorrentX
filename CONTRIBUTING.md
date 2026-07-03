# Contributing

## Development

```bash
npm install
npm run dev -- search ubuntu --mobile
npm run check
```

Node.js 18.18 or newer is required. Runtime dependencies must be pure JavaScript and install cleanly on Windows, macOS, Linux, and Android/Termux ARM devices.

## Source adapters

Adapters belong in `src/sources/` and must:

- implement `SourceAdapter`
- use `HttpClient`
- return normalized results through `createResult`
- honor the provided abort signal
- return an empty array for unsupported media types
- avoid global mutable state
- include parser tests when markup or XML shape is non-trivial

Register stable defaults in `src/sources/index.ts`. Keep source-specific parsing out of the search engine.

## Pull requests

Keep changes scoped and include tests for ranking, filtering, query inference, or parser behavior when those surfaces change. Run:

```bash
npm run check
```
