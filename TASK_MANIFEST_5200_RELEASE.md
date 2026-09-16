# Bond Centre 5.2.0.0 release

- Explicit production authorization: user requested release as 5.2.0.0 and an upper-right release-notes button.
- Baseline: origin/main `9785820`; isolated release worktree `codex/release-5.2.0.0`.
- Scope: approved 5.1.4 Beta queue, fluid todo cards, search beam, result-button clarity, offering-method roundtrip and combined-short-name fixes. Details: `CHANGELOG-5.2.0.0.md`.
- Product/build version: `5.2.0.0`; npm SemVer: `5.2.0`; shared browser cache key: `20260916-release-5200`.
- Validation: 615 tests passed; final asset and production realtime-suspension checks passed (41 tests). Search bundle rebuilt from locked dependencies. Local browser checks cover real snapshot todo layout, release-notes opening/Escape/focus return, and official Beam styles under the unchanged production CSP.
- Beam runtime CSS uses a constructable stylesheet through the build adapter, preserving the official generated rules without permitting inline style elements. CSP remains unchanged.
- Publish only product code and static assets. No local Beta server, snapshot, credentials, test data, database/schema or Gateway changes. Production DM realtime endpoints remain suspended.
- Rollback code baseline: `9785820`; previous successful Pages production deployment: `da106b44-053e-4d6e-9d3f-7ef53ed1bb47`. No database rollback is required for this release.
