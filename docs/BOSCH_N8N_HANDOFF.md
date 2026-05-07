# Bosch Tab — n8n Wiring Fix Handoff

## Problem

The Bosch Bundle Assembler tab in `public/index.html` cannot reach n8n. Every Bosch
network call currently 404s.

Two unrelated tabs (Month-End loader, Confluence rules check) work fine, so n8n
itself, the Cloudflare/CORS setup, and SSO are not at fault. The issue is purely
a wiring mismatch between the Bosch HTML and the three Bosch n8n workflows that
were shipped:

| HTML calls (`public/index.html:1141`)                  | What's actually deployed in n8n            |
| ------------------------------------------------------ | ------------------------------------------ |
| `https://teamqs.app.n8n.cloud/webhook/bosch-claude-vision` | `…/webhook/bosch-invoice-ocr` (workflow `9pEwkmjOF1XUFYDI`, "Bosch Invoice OCR Proxy") |
| `https://teamqs.app.n8n.cloud/webhook/bosch-qnet-query` (used for both agreements and additional-hours, dispatched by a `query` field) | Two separate workflows: `…/webhook/bosch-agreement-lookup` (`UFiEejHojEJi17Ci`) and `…/webhook/bosch-additional-hours` (`A0aUPT8D8qkkOkBx`). No unified dispatcher exists. |

On top of the URL mismatch, the request bodies and response shapes don't line
up either (details below).

A typical Bosch run OCRs roughly **80 pages**, so the OCR endpoint also needs to
handle batching server-side rather than forcing 80 round-trips from the browser.

---

## Decision summary (already agreed)

- **OCR response format**: stay with JSON (what the n8n workflow already
  returns). HTML will be updated to parse JSON instead of CSV.
- **OCR batching**: handled inside n8n. The HTML sends one request with a
  `pages[]` array; n8n loops and aggregates. (This is the main n8n change.)
- **Webhook paths**: keep the existing n8n paths
  (`bosch-invoice-ocr`, `bosch-agreement-lookup`, `bosch-additional-hours`).
  HTML will be updated to point at them.
- **Agreement and additional-hours workflows**: no n8n changes needed. The
  HTML will start sending the field names those workflows already expect.

---

## Part 1 — n8n changes (Cowork: do these)

### 1.1 Update workflow `9pEwkmjOF1XUFYDI` ("Bosch Invoice OCR Proxy")

**Workflow ID**: `9pEwkmjOF1XUFYDI`
**Production path**: keep as `/webhook/bosch-invoice-ocr` (POST)
**Goal**: accept a batch of invoice page images, OCR each via Claude Vision,
and return a single aggregated JSON response.

#### New request contract (what the HTML will send)

```json
POST /webhook/bosch-invoice-ocr
Content-Type: application/json

{
  "pages": [
    { "imageBase64": "<base64 jpeg>", "mediaType": "image/jpeg" },
    { "imageBase64": "<base64 jpeg>", "mediaType": "image/jpeg" }
  ],
  "billingMonth": "2026-04",
  "systemPrompt": "<optional override>"
}
```

- `pages` is required and is an array of 1..N items. Expect up to ~100 pages
  per request in normal use. If a `pages` array is absent but the legacy
  single-image fields (`imageBase64`, `mediaType`) are present, accept the
  legacy shape as a one-element batch — that gives us a soft transition
  window.
- `billingMonth` is informational (forwarded into the system prompt for
  context); it is not used to gate the request.
- `systemPrompt` is optional. Default it to the prompt below if absent.

#### Default system prompt

Use this exact text as the default; it constrains Claude's output to the
schema the HTML parses.

```
You are extracting structured data from a single page of a Bosch supplier invoice.
Return ONLY a single JSON object — no prose, no code fences. Schema:

{
  "invoiceNumber": "string (the invoice number printed on this page, or empty string if not present)",
  "location": "string (the customer location / plant name as printed, or empty string)",
  "agreementNumber": "string (the Qnet agreement number such as R12345 if visible, otherwise empty string)",
  "total": number (the line total or invoice total in USD as a plain number, no $ or commas; 0 if absent)
}

If a field is illegible or absent, return an empty string for string fields and 0 for total. Do not guess.
```

#### Workflow design

Replace the current single-shot HTTP-Request → Set → Respond chain with a
batched flow. Concretely:

1. **Webhook node** — `POST /webhook/bosch-invoice-ocr`, Response Mode =
   "Respond to Webhook" (unchanged).
2. **Code node ("Normalize input")** — read `$json.body`. If `body.pages`
   exists and is a non-empty array, emit one item per page with
   `{ imageBase64, mediaType, pageIndex, systemPrompt, billingMonth }`. If it
   doesn't, fall back to a single-element batch built from
   `body.imageBase64` / `body.mediaType`. Default `mediaType` to
   `"image/jpeg"`. Default `systemPrompt` to the prompt above.
3. **Split In Batches** (size 5) — bounds concurrency so we don't hammer the
   Anthropic API. Adjust upward only after observing real run times.
4. **HTTP Request node ("Call Claude Vision")** — same call as today
   (`POST https://api.anthropic.com/v1/messages`, `claude-sonnet-4-20250514`,
   `max_tokens: 2048`, `anthropic-version: 2023-06-01` header, generic header
   auth credential), but with the per-page values plugged in:
   ```
   {
     "model": "claude-sonnet-4-20250514",
     "max_tokens": 2048,
     "system": {{ $json.systemPrompt }},
     "messages": [{
       "role": "user",
       "content": [
         { "type": "image", "source": {
             "type": "base64",
             "media_type": {{ $json.mediaType }},
             "data": {{ $json.imageBase64 }}
         }},
         { "type": "text", "text": "Extract the invoice data from this page and return only the JSON object." }
       ]
     }]
   }
   ```
   Keep `onError: continueErrorOutput` and a 120s timeout per page.
5. **Code node ("Parse page result")** — for each item, take
   `$json.content[0].text`, strip code fences if present, `JSON.parse` it,
   and emit `{ pageIndex, success: true, invoice: <parsedObject> }`. On parse
   failure emit `{ pageIndex, success: false, error: "<message>", raw: text }`
   so the HTML can log it without aborting the whole run.
6. **Merge / collect** — re-aggregate all per-page items back into a single
   array (the standard "Split In Batches" loop output works; otherwise use a
   final Code node that pulls `$items()` into an array).
7. **Respond to Webhook** — return:
   ```json
   {
     "success": true,
     "pageCount": <int>,
     "results": [
       { "pageIndex": 0, "success": true,  "invoice": { "invoiceNumber":"…", "location":"…", "agreementNumber":"…", "total": 0 } },
       { "pageIndex": 1, "success": false, "error": "…", "raw": "…" }
     ]
   }
   ```
   Keep the existing CORS response headers
   (`Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: Content-Type`).

   On a top-level failure (e.g. malformed input), respond with
   `{ "success": false, "error": "<message>" }` and HTTP 200 (so the browser
   can read the body) — the current error path already does this.

#### Validation checklist (please run before marking done)

- [ ] POST a 1-page request → response has `results.length === 1`.
- [ ] POST a 3-page request → response has `results.length === 3` and the
      `pageIndex` values are `0,1,2` in order.
- [ ] POST a request with one deliberately blank/garbage page → that page
      comes back with `success: false` while the others come back with
      `success: true`. The webhook returns 200, not 500.
- [ ] Legacy single-image body
      (`{imageBase64, mediaType}`, no `pages` field) still returns a
      one-element `results` array.

### 1.2 No changes needed to the other two Bosch workflows

`UFiEejHojEJi17Ci` ("Bosch Agreement Lookup") and `A0aUPT8D8qkkOkBx`
("Bosch Additional Hours Lookup") already work as designed. The HTML will be
updated to send the field names they already expect. Please do **not** modify
their request schemas — the HTML side will conform.

For reference, the contracts they already have:

**Bosch Agreement Lookup** — `POST /webhook/bosch-agreement-lookup`
```json
{ "supplierId": 226, "billingPeriodStart": "YYYY-MM-DD", "billingPeriodEnd": "YYYY-MM-DD" }
```
Returns the rows from the agreements query as a JSON array.

**Bosch Additional Hours Lookup** — `POST /webhook/bosch-additional-hours`
```json
{ "billingStart": "YYYY-MM-DD", "billingEnd": "YYYY-MM-DD" }
```
Returns the rows from the additional-hours query as a JSON array.

---

## Part 2 — HTML changes (will be done in this repo, not by Cowork)

Listed here so the contracts on both sides stay in sync. These edits live in
`public/index.html`.

1. **Webhook URL block (`public/index.html:1141`)** — replace the two-entry
   `BOSCH_WEBHOOKS` object with three entries pointing at the real n8n
   paths:
   ```js
   const BOSCH_WEBHOOKS = {
     claudeVision:   'https://teamqs.app.n8n.cloud/webhook/bosch-invoice-ocr',
     agreements:     'https://teamqs.app.n8n.cloud/webhook/bosch-agreement-lookup',
     additionalHours:'https://teamqs.app.n8n.cloud/webhook/bosch-additional-hours',
   };
   ```

2. **`boschCallClaudeVision` (`public/index.html:4411`)** — keep the
   `pages[]` request shape (which now matches n8n after Part 1), but parse
   the new response:
   - POST `{ pages: [{ imageBase64, mediaType:'image/jpeg' }, …], billingMonth }`.
   - Read `data.results`, log per-page failures via `boschLog`, and return
     the array of successful `invoice` objects.

3. **Drop `boschParseOcrCsv` (`public/index.html:4422`)** — no longer needed.
   Replace its single call site (`public/index.html:4528`) so the OCR step
   assigns the returned invoices directly into `BOSCH.invoices`, then
   aggregates `pageCount` per `(invoiceNumber, location)` key client-side.

4. **`boschFetchAgreements` (`public/index.html:4442`)** — change the body
   to `{ supplierId: 226, billingPeriodStart, billingPeriodEnd }`. Source
   `billingPeriodStart`/`End` from the period inputs already used elsewhere
   in the tab (or compute them from `billingMonth`).

5. **`boschFetchAdditionalHours` (`public/index.html:4451`)** — change the
   body to `{ billingStart, billingEnd }` and point it at
   `BOSCH_WEBHOOKS.additionalHours`.

---

## Order of operations

1. Cowork lands the n8n change in **Part 1.1** (back-compat fallback for
   single-image bodies means this is safe to ship before the HTML side).
2. HTML changes in **Part 2** land on branch
   `claude/fix-bosch-n8n-requests-VYiTo` and merge to main.
3. Smoke test in production: open the Bosch tab, run a real ~80-page
   bundle end-to-end, confirm OCR + agreements + additional-hours all
   succeed.

If anything in the n8n response shape ends up different from what's
documented above, ping back here so the HTML side can be adjusted in the
same PR.
