# 013. `agent test`

| Priority | Effort       | Status      |
| -------- | ------------ | ----------- |
| P2       | Medium-large | Not started |

**Payoff:** Catch behavioral-contract and artifact regressions.

Not implemented. This page records the original proposal, not current behavior.

**Command sketch:**

```text
claude-cli agent test ./bundle
claude-cli agent test ./bundle --target all --native
```

Support model-free contract tests stored with a bundle. Test cases could assert selected
targets/profiles, rendered paths, manifest fragments, compatibility diagnostics, transformed
placeholders, hook schemas, policy examples, and golden output digests.

An opt-in `--native` mode could run installed host validators in temporary directories with
timeouts and no network. Model-driven behavioral evaluations should be a later, explicitly
configured integration: they are nondeterministic, can cost money, and should not become a
requirement for ordinary validation.

---

[Back to the idea index](_contents.md)
