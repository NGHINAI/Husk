# Example 02 — Static Form Fill Agent

Demonstrates Husk's watchdog (sanity + policy layers) end-to-end.

## What it does

Navigates to a simple controlled form page (hosted in
`examples/02-static-form-fill/test-site/`), fills out fields using an
agent loop with watchdog policy rules enforcing "required checkbox
checked before submit" and "no typing into SSN fields."

## What it tests in Husk

- Action planner: `type`, `click`, `press` operations
- Watchdog sanity layer: rejects clicks on hidden / non-existent
  elements
- Watchdog policy layer: enforces `required_before` and `forbidden`
  rules from `policy.yaml`

## Status

Stub — full implementation lands in Milestone 6.

## License

MIT (this directory is covered by `LICENSE-EXAMPLES`).
