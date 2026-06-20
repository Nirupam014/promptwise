# Security Policy

## Supported versions

PromptWise is pre-1.x in spirit; the latest released `1.x` line receives security
fixes.

| Version | Supported |
|---------|-----------|
| 1.x     | ✅        |
| < 1.0   | ❌        |

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, use GitHub's **private vulnerability reporting** —
[open a draft advisory](https://github.com/Nirupam014/promptwise/security/advisories/new)
(repo → Security → Report a vulnerability). Include:

- a description of the issue and its impact,
- steps to reproduce (a proof of concept if possible), and
- any suggested remediation.

You can expect an acknowledgement within a few days. Once a fix is available,
we'll coordinate a disclosure timeline with you and credit you (if you wish).

## Scope notes

The core engine is fully local and makes **no network calls** — prompt content
never leaves the device. The most security-relevant surfaces are:

- the **browser extension** (runs in the page context of AI chat sites), and
- the **VS Code extension** (reads editor content and stores memory in
  `globalState`).

Reports about data exfiltration, injection into the host page, or unexpected
network activity from any package are especially welcome.
