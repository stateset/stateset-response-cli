# StateSet ResponseCLI Release Notes (v1.7.6)

## Overview

StateSet ResponseCLI `v1.7.6` hardens authentication and file-write security paths while improving runtime safety and resilience for integrations.

## Highlights

### Security hardening
- Enforced HTTP(S)-only validation for device verification URLs in auth flow.
- Updated Windows browser opening path to avoid shell interpretation risks.
- Hardened local policy/permission/export/cache writes:
  - reject symlinked write targets
  - enforce stricter file mode defaults (`0600`) with directory mode tightening (`0700`)
  - apply safer output-path validation for policy/export destinations

### Runtime reliability
- Fatal global error handlers now force process termination after logging, preventing continued execution in an undefined state.
- Gorgias integration now uses the retrying HTTP helper for better transient failure handling.

### Test coverage
- Added and updated tests for:
  - unsafe device verification URL rejection
  - unhandled-rejection exit behavior
  - symlink-safe policy write protections
  - secure write options in export/policy command paths
  - Gorgias retry-helper request path

## CLI entry points

- `response`
- `response-whatsapp`
- `response-slack`
- `response-gateway`
