# 016. Additional Targets Through an Adapter Interface

| Priority | Effort                   | Status      |
| -------- | ------------------------ | ----------- |
| P3       | Per target: medium-large | Not started |

**Payoff:** Broaden reach after target maintenance is sustainable.

Not implemented. This page records the original proposal, not current behavior.

Its prerequisites — target profiles, native overlays, and conformance fixtures — are all
shipped; no additional target has been adopted.

More agent hosts will be requested, but adding them directly to the current renderer would
multiply compatibility debt. After target profiles, native overlays, and conformance fixtures
exist, define an internal adapter contract for detection, validation, rendering, diagnostics,
and packaging.

Choose new built-in targets from demonstrated use rather than name recognition. A target
should have stable, public native formats; a meaningful overlap with the bundle model; fixture
coverage; and a maintainer willing to track upstream changes. Third-party adapters could be
considered later, but loading arbitrary adapter code would create a supply-chain boundary and
should not be the first extensibility mechanism.

---

[Back to the idea index](_contents.md)
