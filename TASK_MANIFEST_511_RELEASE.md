# Bond Centre 5.1.1

- Base: b4290ba (5.1.0.1), branch codex/bond-511beta.
- User explicitly authorized production release.
- Changes: CHANGELOG-5.1.1.md; no database, Gateway, local fixture or Trade Format changes.
- Validation: 159 targeted tests passed (assets, DM, screenshot OCR, reminders, valuation UI and production); syntax and whitespace checks passed.
- Local preview: http://127.0.0.1:8814/bond-centre/ (isolated fixtures outside repo).
- Live DM full-name verification still requires real-data acceptance; automated contract cases cover code verification, ambiguous candidates, wrong issue and old issue years.
