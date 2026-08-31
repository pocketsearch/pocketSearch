# Contributing to Beacon Search

Thanks for taking the time to contribute! This project aims to stay small,
dependency-light and easy to run anywhere.

## Getting set up

```bash
npm install
npm run dev      # API on :7700, UI on :5173
```

## Before opening a pull request

Run the full local check — CI runs the same steps:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

`npm run format` applies Prettier.

## Guidelines

- **Keep `src/core/` free of HTTP concerns.** The engine, crawler and storage
  must be usable without Fastify (the CLI depends on this).
- **Add tests** for new behaviour. Core logic is covered by fast unit tests;
  HTTP behaviour is covered via `app.inject()` in `src/server/app.test.ts`.
- **No new runtime dependencies** without discussion. Prefer the standard
  library (the crawler uses the built-in `fetch`, config loads `.env` via
  `process.loadEnvFile`).
- Match the existing code style; Prettier + ESLint are the source of truth.

## Reporting bugs

Open an issue with reproduction steps, the version, and the relevant log output
(`BEACON_LOG_LEVEL=debug`).

By contributing you agree that your contributions are licensed under the MIT
License.
