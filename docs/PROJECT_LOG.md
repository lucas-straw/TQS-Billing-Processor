# Billing Processor — Project Log

Running notes for cross-session continuity. Update this whenever a session ends with meaningful state changes, open questions, or decisions worth carrying forward. Pair with:

- `CLAUDE.md` (root) — high-level architecture and rules-of-the-road
- `docs/ROLLBACK.md` — per-version SHAs and revert playbook
- This file — running narrative

When starting a new session, prompt with: *"Read `docs/PROJECT_LOG.md`, `docs/ROLLBACK.md`, and `CLAUDE.md` to catch up on the project state."*

---

## Current shipped state (latest first)

| Version | Date | Highlights | SHA |
|---|---|---|---|
| v1.7.7 | 2026-04-30 | Step 3 bulk actions (Accept All / Skip All / section bulk) now visually flip the per-row buttons via the `act` class. Pending KPI counter now reflects live decision state. | _pending merge_ |
| v1.7.6 | 2026-04-30 | Case-insensitive column lookup in recon CSV gen (fixes empty MEMO on retro rows). Adds PROJECT_LOG.md. | `7618091` |
| v1.7.5 | 2026-04-30 | Per-retro prior-rows expandable detail (with shutdown overlap highlighting). Currency-neutral KPIs (counts, not mixed-$ totals). Auto-Matched counter as completeness signal. | `b7a93bd` |
| v1.7.4 | 2026-04-30 | Hotfix: unhide `#rs4` Step 4 card so Generate Augmented CSVs button produces visible output. | `cbbe975` |
| v1.7.3 | 2026-04-29 | Diagnostic surfaces extracted-but-unmatched MEMO agreement number with likely causes. | `b7a6249` |
| v1.7.2 | 2026-04-29 | Retro-row context: prior ITEMDESC, MEMO, row count, source sheet + specific diagnostic notes. | `b2ea095` |
| v1.7.1 | 2026-04-29 | Hotfix: scope retros to pre-bill customers only (was iterating union of billed + expected, generated phantom retros for every priced agreement in DB — ~600 false positives). | `6f036c0` |
| v1.7.0 | 2026-04-28 | Pre-Bill Reconciliation Phase 3 — AH/WP retros (CU absorption rule, day-count tier, FR skipped). | `2faa834` |
| v1.6.0 | 2026-04-28 | Pre-Bill Reconciliation Phase 2 — `expectedSnapshot` + retro diff for shutdowns / contracted units / pricing / shutdown credits. Step 3 review UI + Step 4 augmented CSV gen. Adds `docs/ROLLBACK.md`. | `3c2ae59` |
| v1.5.0 | 2026-04-28 | Pre-Bill Reconciliation Phase 1 — tab navigation, period inputs, file uploads, `billedSnapshot` builder, `DB_PRIOR` loader. Foundation only; algorithm in v1.6+. | `dee7e9b` |
| v1.4.0 | 2026-04-28 | Test-account block fixes (per-row, case-insensitive, auto-approved). Per-item dynamic date defaults (`iA/gA`…`iD/gD`) with `computeBillingCycle()`. | `6c8a429` |
| v1.3.0 | 2026-04-27 | Additional-hours producing-facility routing (Autoliv-style). Editable C-code input in Manual Action; CSV-time strip+split. | `d7f5c05` |
| v1.2.0 | 2026-04-27 | Mid-period agreement-coverage audit. DB.contractedMap wiring. In-app changelog with version badge. | `57d3a15` |

---

## Active work / open items

### Reconciliation feature

**Current state:** core loop works (upload prior + new pre-bill → DB diff → Step 3 review → Step 4 augmented CSV download). Real-data testing in progress with Lucas using March/April data.

**Verified working:**
- Tab nav, period auto-fill, file upload + parsing
- `billedSnapshot` per (cust × SA × itemId)
- `DB_PRIOR` loader (separate from Month-End `DB`)
- `expectedSnapshot` for: contracted-units, monthly-pricing, flat-rate, shutdown-credit
- `expectedSnapshot` Phase 3 types: additional-hours (with absorption rule), weekend-production (with day-count tier)
- Per-retro prior-row detail with shutdown-week highlighting
- Augmented CSV gen with retro-row append (Case A) and standalone block for orphans (Case B)

**Open items / not yet shipped:**

1. **HST / VAT recomputation against new retro net** — when contracted-units retro changes the taxable base, the existing tax row should also adjust. Currently not computed. Spec section 3.3 calls it out but I haven't built it yet.

2. **Volume discount recomputation** — same shape: if a CU retro changes the customer's billing tier, the 1096 discount needs adjusting. Not built.

3. **Producing-facility routing for AH retros** — when an AH retro is for an agreement where `additionalHourResponsibility = 'Producing Facility'`, the retro should bill to the producing facility's C-code, not the parent. Currently emits under the agreement's `customerCode`/`accountNumber`. Workaround: use Skip + manual reroute via Month-End workflow.

4. **SharePoint upload for the augmented pre-bill** — Phase 2 deferred this. Spec says the SharePoint location should default to `Pre-Invoices/{YYYY}/{MM Month}/`. The button is wired but currently shows an alert.

5. **Confluence updates** — once the recon flow ships fully, the end-of-period AH/WP recap is dead. Confluence pages 694386707 and 1627095047 need updating to reflect the new flow. Not a code task.

### Bug-watch / things to verify after each Lucas run

- **MEMO column on retro rows** (fixed v1.7.6 with case-insensitive lookup — verify on next run)
- **Auto-Matched count** — should be a healthy number (a few hundred). If suspiciously low while billed cells are high, DB_PRIOR didn't load enough data.
- **n8n Query 5 priceType filter** — confirmed `OR a.priceType IS NULL` was added by Lucas on 2026-04-30. If new "Reference RXXX found in MEMO but not in DB_PRIOR" diagnostics appear with NEWER agreement numbers, may need to check the filter again or look at expireTime cutoffs.

---

## Key decisions (irreversible without revisiting)

| Decision | When | Why |
|---|---|---|
| Calendar-month rule for `computeBillingCycle()` (cycle = current calendar month's last Sunday, regardless of whether today > last Sunday) | v1.4.0 | Spec rule text contradicted spec verify example. Verify example matched team's actual workflow (accountants finish cycle in days after Sunday but before next month begins). Implemented to match the example. |
| Squash-merge for all PRs | ongoing | Clean per-feature commit on main; simple `git revert <sha>` for any rollback. Documented in `docs/ROLLBACK.md`. |
| Pre-bill customers = customers in prior pre-bill file (not from DB) | v1.7.1 | Spec section 3.1 explicit. Iterating union of billed + expected generated phantom retros for every priced agreement. |
| Currency-neutral KPIs in Step 3 | v1.7.5 | Mixed-currency $ totals were nonsense. Counts (rows added / removed / matched) are immediately useful. |
| Auto-Matched as completeness signal | v1.7.5 | Lucas asked "how do I know nothing else changed?" — counter shows how many (cust × SA × type) cells were checked but balanced. |
| Phasing the recon feature into v1.5/1.6/1.7 | 2026-04-28 | Spec explicitly suggested phased delivery. Each phase independently shippable. |
| Auto-approve test-account blocks (`approved: true` instead of `null`) | v1.4.0 | Hard rule, not a judgment call. Removes friction. |

---

## n8n workflow notes

**Workflow:** `billing-processor-db` (id `AJwkePsQAFTHSNKF`) on `https://teamqs.app.n8n.cloud`
**Webhook:** `https://teamqs.app.n8n.cloud/webhook/billing-processor-db?pStart=YYYY-MM-DD&pEnd=YYYY-MM-DD`

Returns:
- `shutdowns` — plant shutdowns active in period
- `marelliSuppressedSageCodes` — Marelli SAs with Flat Rate $0
- `pricedAgreements` — Flat Rate + Monthly Pricing
- `contractedAgreements` — Contracted Units (Legacy or NULL priceType)
- `weekendProduction` — WP rows in period
- `additionalHours` — approved AH rows in period (filtered by `approvedTime`)
- `invoiceSettings` — `accountNumber → 'Normal' | 'Days The Plant Is Open'`

The actual SQL strings live in the **build queries** Code node (output goes to a downstream Execute Query node via `{{ $json.sql }}`). Each query is a `sql*` field on the output JSON.

**Query 5 (contractedAgreements) WHERE clause** (verified live as of 2026-04-30):
```sql
WHERE (a.deleted IS NULL OR a.deleted = 0)
  AND (a.priceType = 'Legacy (Contracted Units)' OR a.priceType IS NULL)
  AND a.rate > 0
  AND l.sageLocationCode IS NOT NULL
  AND (a.expireTime IS NULL OR a.expireTime >= '${pStart}')
  AND a.startTime <= '${pEnd}'
```

Not yet on the n8n side: `agreementProducingFacilities` payload field for auto-suggesting AH-routing C-codes. Without it, the input on the Month-End tab is blank and the user types it in (full functionality, no auto-fill).

---

## Tested data points

| Date | Period | Test type | Outcome |
|---|---|---|---|
| 2026-04-30 | March/April recon | First real-data recon run | ~600 phantom retros (false positives). Root cause: priceType filter in n8n Q5 missing `OR IS NULL`. Fixed. |
| 2026-04-30 | March/April recon | Re-run after n8n fix | 22 CU retros, 3 AH retros, 1 WP retro. Lucas requested per-row detail + count-based KPIs + auto-matched signal — shipped as v1.7.5. |
| 2026-04-30 | March/April recon | Step 4 download | Empty MEMO on retro rows reported. Root cause: case-sensitive column lookup. Fixed in v1.7.6 (this commit). |

---

## How to use this log

**At session start:**
- Tell Claude: *"Read `docs/PROJECT_LOG.md`, `docs/ROLLBACK.md`, and `CLAUDE.md` to catch up."*

**At session end (or after each meaningful change):**
- Have Claude append to this log: latest version row, any new open items, any decisions worth preserving, and a row in the test-data table if a real-data run produced new findings.

**When something breaks:**
- Note the symptom under "Active work / open items" → bug-watch.
- Once root cause is found, move it to "Tested data points" with the resolution.
