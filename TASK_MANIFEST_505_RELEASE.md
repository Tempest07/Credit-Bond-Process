# 5.0.5 release

- Target: Bond Centre production main, approved by user on 2026-09-09.
- Source: codex/bond-505beta based on a8ee497; cherry-picked no 5.1 commits. Adapted approved valuation UI to the existing renderer and API contract.
- UI sources reviewed: .bond-510beta/bond-centre/valuation-assistant.css and valuation-assistant.js, design manifest. These files were not copied or modified.
- Existing valuation endpoint unchanged. No model, learning, sample service, migrations, database or Gateway changes.
- Validation: 187 targeted tests; syntax and git whitespace checks. Local preview confirms version and date default. UI unit checks cover legacy rendering, source/date/bp, collapsed details, missing estimates and offering type.
- Local preview: http://127.0.0.1:8812/bond-centre/. Local preview fixtures remain outside repository.
- Release notes: CHANGELOG-5.0.5.md.
