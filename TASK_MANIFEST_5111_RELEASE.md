# Bond Centre 5.1.1.1 hotfix

- Goal: reproduce and fix protocol-transfer Word price being populated from trade amount; publish to main as requested.
- Base: 66c67d3 (5.1.2), preserving existing released functionality. Display/build version 5.1.1.1; npm-compatible package version 5.1.1-1.
- Reproduction: `100/99.998 净价 5000` produced price 5000 and Word net-price cell 5000.000. With spaces around the slash, amount could also become 100.
- Changed business modules: protocol-transfer.js and secondary-inventory.js. Word templates and document layout are unchanged.
- Verification: failing regression reproduced before the fix, then 112 targeted tests passed covering parsing, secondary routing, manual overrides, three real built-in DOCX ZIP templates, ledgers, converter compatibility and version/cache assets. JavaScript syntax and git diff checks passed.
- Deployment: existing GitHub main to Cloudflare Pages pipeline; verify production build metadata and exact served module contents after push.
- Data boundary: no cloud state writes, database migrations, Gateway changes, local preview files or local demo-data uploads. Synthetic regression strings remain within tests only.
- Existing malformed saved records are not automatically rewritten; reparse/correct and regenerate as needed.
