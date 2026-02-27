# Contributing

## Development Setup

1. `npm ci`
2. `npm run build`
3. `npm run check`

Node.js `18+` is required.

## Workflow

1. Create a feature branch from `master`.
2. Make focused changes with tests.
3. Run `npm run check` locally before opening a PR.
4. Open a PR with:
   - problem statement
   - solution summary
   - testing evidence

## Testing and Quality

- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Format check: `npm run format:check`
- Full coverage: `npm run test:coverage`
- Core strict coverage: `npm run test:coverage:core`

## Commit Hygiene

- Keep commits scoped and descriptive.
- Prefer conventional prefixes (`feat:`, `fix:`, `chore:`, `test:`).
- Avoid unrelated refactors in feature fixes.
