# Security Policy

## Reporting a vulnerability

**Please do not open a public issue, pull request, or discussion for security
problems.**

Report privately to **we@holons.io** with:

- a description of the issue and its impact,
- steps to reproduce (proof-of-concept if possible),
- affected package(s)/version(s) and any known mitigations.

If you prefer, use GitHub's **private vulnerability reporting**
("Report a vulnerability" under the repository's *Security* tab).

### What to expect

- **Acknowledgement:** within 3 business days.
- **Assessment & triage:** within 10 business days, with a severity and a
  remediation plan.
- **Fix & disclosure:** coordinated with you. We aim to ship a fix before any
  public disclosure and will credit you unless you ask otherwise.

Please give us a reasonable window to remediate before any public disclosure.
We do not currently run a paid bug-bounty program; we are grateful for
responsible disclosure.

## Supported versions

Holons is pre-1.0 and evolving. Security fixes target the `main` branch and the
latest published packages. Pin a commit/version if you need stability and watch
releases for security updates.

## Scope & hardening notes

- **Never commit secrets.** `.env`, `.env.*`, and `.mcp.json` are gitignored.
  If a credential is exposed (including in a git remote URL or commit history),
  **revoke and rotate it immediately** — rotation is the only real fix; removal
  from history is secondary.
- Holosphere data is peer-to-peer; treat anything written to a holon namespace
  as readable by that holon's peers. Do not store secrets in Holosphere.
- Validate and sanitize all user input before persisting it.

Thank you for keeping Holons and its community safe.
