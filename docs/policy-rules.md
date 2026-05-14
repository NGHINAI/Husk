# Watchdog Policy Rules

> Milestone 1 placeholder. Full policy rules guide lands in Milestone 5.

The Husk watchdog has two deterministic layers:

1. **Sanity rules** — always on, hard-coded. Verify element existence,
   visibility, enabled state, interactive role compatibility before an
   action. Verify expected mutation, no error alerts, URL consistency
   after.

2. **Policy rules** — opt-in, declarative YAML. Per-flow forbidden /
   required-before / allow-domain / deny-domain rules.

See the full spec, Section 5.3, for the rule schema and matching
semantics.
