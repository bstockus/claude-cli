# 005. Native Overlays and a Richer Component Model

| Priority | Effort | Status  |
| -------- | ------ | ------- |
| P1       | Medium | Shipped |

**Payoff:** Preserve platform-only features without false portability.

Delivered by [`agent convert`](../../commands/agent-convert.md) and [`agent
doctor`](../../commands/agent-doctor.md). The proposal below is the original text; where the
implementation diverged, the command's own documentation is authoritative.

Do not force every emerging platform feature into a portable abstraction. Introduce a clear
two-layer bundle:

```text
portable-bundle/
  agent-bundle.yaml
  skills/
  agents/
  hooks/
  rules/
  policies/
  mcp/
  native/
    claude-code/
    codex/
    cursor/
```

The portable layer should remain limited to concepts with defensible cross-target semantics.
The native overlay can hold platform-only components and manifest fragments, such as richer
listing metadata, target-specific app/UI wiring, LSP or monitor definitions, themes,
scheduled-task templates, and host-specific permission settings.

Rendering should merge overlays deterministically, diagnose collisions, record which output
came from portable versus native source, and forbid an overlay from escaping its target root.
This gives users access to new platform capabilities immediately without pretending they are
portable or waiting for a new neutral schema revision.

---

[Back to the idea index](_contents.md)
