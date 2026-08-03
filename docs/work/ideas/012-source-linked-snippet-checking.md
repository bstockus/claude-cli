# 012. Source-Linked Snippet Checking

| Priority | Effort | Status      |
| -------- | ------ | ----------- |
| P2       | Medium | Not started |

**Payoff:** Detect documentation examples that drift from code.

Not implemented. This page records the original proposal, not current behavior.

**Command sketch:**

```text
claude-cli md check-snippets docs
claude-cli md check-snippets docs --write
```

Allow fenced code blocks to declare a source file and named region or line span. The checker
would compare the documented snippet with the source, report drift, and optionally refresh
only explicitly linked blocks.

This fits the current code-block extraction and audit model and solves a common documentation
failure without executing untrusted code. Prefer named regions or stable markers over raw line
ranges. Define one conservative metadata syntax, preserve fence attributes and indentation,
and never run the snippet as part of synchronization.

---

[Back to the idea index](_contents.md)
