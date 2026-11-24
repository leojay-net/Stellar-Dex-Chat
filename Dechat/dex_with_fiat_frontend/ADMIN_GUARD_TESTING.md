# AdminGuard test coverage

The AdminGuard authorization boundary is covered by
`src/components/__tests__/AdminGuard.test.tsx`.

The suite verifies the protected-content behavior for an allowed administrator,
an unauthenticated visitor, a malformed address, and a non-admin address. Run
the focused suite with:

```bash
npm run test -- src/components/__tests__/AdminGuard.test.tsx
```

This document records the coverage requested in issue #595 and gives
maintainers a direct CI-equivalent command for reviewing it.
