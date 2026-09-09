# 5.1.0 release

- User authorized production release on 2026-09-10, retaining the original assistant and adding the experimental assistant.
- Release worktree starts from origin/main f5aad36 (5.0.5). Only the standalone experimental modules and raw-evidence collector were ported from 5.1beta; no inherited 5.0.5 patch replayed.
- UI: original valuationAssist remains; experimentalValuationAssist has its own explicit entry and no automatic pricing writes.
- Production: authenticated Pages /api/valuation/* collects DM evidence and forwards through the existing authenticated AI tunnel. The 11435 gateway shares the existing inference lock; default gpt-oss:20b only.
- Persistence: ignored .local-data/valuation-users/<user hash>.json on the local computer. No D1/project-state migration; no beta sample history imported. Computer/service must remain online.
- Existing Windows Gateway task action now points to this release worktree. Previous task XML backed up outside repo at ../gateway-task-before-510.xml. Tunnel task unchanged. Health verified issuance, vision and valuation version5.1.0.
- Validation: 63 focused asset/model/provider/gateway tests, DM lookup/legacy valuation regression tests, Pages Functions compile and whitespace checks passed. New tests include auth, evidence substitution, user isolation and shared locking.
- Production deployment and live acceptance: pending final verification.
