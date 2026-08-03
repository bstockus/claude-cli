---
name: helper
description: A helper agent
model: balanced
tools: [read, web]
exclude: [cursor]
targets:
  claude-code:
    tools: [Read, WebFetch]
---
Help out.
