# Admin credentials: draft and publication

The internal admin API accepts one of two shared secrets in the `x-foodswipe-admin-secret` header.

| Env var | Scope | Intended holder |
|---|---|---|
| `FOODSWIPE_ADMIN_SECRET` | **publish** (everything; unchanged from before) | the human administrator |
| `FOODSWIPE_ADMIN_DRAFT_SECRET` (optional) | **draft** | an ingestion agent (Claude Code, Codex) |

The draft secret is ignored (draft access stays disabled) if it is unset, shorter than 16 characters, or identical to the publication secret. A credential that matches neither is a 401; there is never a fallback from an invalid draft credential to the publication credential.

## What a draft credential can do
Read candidates, video candidates, published restaurants and photo/hero data; search restaurants (`/restaurants/lookup`); import candidates from Google Places (preview and write); create and edit draft candidates (status only `candidate` or `needs_review`); create and edit video candidates that are still `needs_review`; run tag suggestions, website evidence and video discovery; call the YouTube resolver.

## What it can never do (403 `insufficient_scope`, before any database access)
Approve or reject a restaurant candidate or video candidate; edit a candidate or video candidate once it is approved; promote a candidate; attach a video; choose or clear a hero photo; edit or hide a published restaurant; add, hide or otherwise modify a live video, including the direct-add shortcut.

## Route matrix
The authoritative list is `POLICY` in `scripts/admin-authz-check.mjs`, which fails if an admin route is added without a declared scope.

## Audit attribution (Admin Hardening B)
Every consequential change is written to the append-only `admin_events` table in the same SQL statement as the change (see [admin-audit-log.md](admin-audit-log.md)). The actor recorded is a **non-secret label for the credential that authenticated the request**: `publish-credential` or `draft-credential` by default, or an operator-chosen label from the optional env vars `FOODSWIPE_ADMIN_PUBLISH_LABEL` / `FOODSWIPE_ADMIN_DRAFT_LABEL` (letters, digits, `.`, `_`, `-`; max 40; anything else is ignored). The label is not a secret and is never derived from one. Every event also records `actorAssurance: "shared-credential"`: the log proves *which credential* acted, **not which person**. Reading the audit history needs the publication credential; the draft credential is refused.

## Notes
- The shared secrets are still bearer secrets. Rotate by changing the env var and redeploying. Per-agent revocation and per-person identity are the follow-up task; until then two agents sharing the draft secret are indistinguishable in the log, and do not run unattended or large-batch ingestion.
- Never paste a secret into chat or a command line. Read it from an environment variable. A reason typed into `auditReason` that contains a configured secret is refused.
