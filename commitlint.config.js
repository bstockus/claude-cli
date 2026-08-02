/**
 * Conventional Commits are load-bearing here: semantic-release derives the next
 * version from these messages. A commit that does not parse produces no release.
 *
 *   fix: ...            -> patch    (1.0.0 -> 1.0.1)
 *   feat: ...           -> minor    (1.0.0 -> 1.1.0)
 *   feat!: / BREAKING CHANGE: -> major (1.0.0 -> 2.0.0)
 *   chore:/docs:/test:/refactor:/ci: -> no release
 */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // semantic-release generates the release commit body from the changelog, which
    // contains long commit URLs that cannot be wrapped. The default 100-char cap
    // rejects them. Same reasoning for footers (BREAKING CHANGE notes, links).
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
