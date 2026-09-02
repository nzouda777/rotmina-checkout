# Morning (Green Invoice) API — Auth Migration

**Status:** **Not an outage.** Verified live on 2026-09-02: the legacy auth endpoint still returns `200`. This is a **planned migration ahead of deprecation**, not a fix for an active failure. Our existing production credentials already authenticate successfully against the new endpoint.

**File:** `lib/morning.ts`
**Spec verified against:** `https://developers.morning.co/docs/openapi.bundled.json` — *morning API Documentation, OpenAPI 3.0.3, version 2.0.0*
**Date:** 2026-09-02

---

## 1. TL;DR for review

| | |
|---|---|
| **What's changing** | Authentication only. Morning moved token issuance to a new OAuth 2.0 identity service on a different host. Our `getAccessToken()` still calls the legacy endpoint, which is absent from the v2.0.0 spec and will be retired. |
| **Impact today** | **None confirmed.** A live probe on 2026-09-02 shows the legacy endpoint still answering `200` with a valid `token`. Receipts are not failing for authentication reasons right now. |
| **Risk if we do nothing** | The day Morning retires `/account/token`, every receipt across all five checkout flows fails at `getAccessToken()` and logs `Morning receipt failed (non-fatal)`. The failure is **silent** — customers get no receipt, payments still succeed, nothing alerts. We would likely learn about it from a customer complaint. |
| **Blocking change** | One function: `lib/morning.ts:93-127`. |
| **Decisions needed** | One only: are we OK with a single live production test receipt? See §6. (The sandbox-credentials question is now resolved — see §2.1.) |

---

## 2. What actually changed

Three things changed simultaneously, which is why a partial fix will not work.

| | Current (broken) | Required |
|---|---|---|
| **Host** | `api.greeninvoice.co.il` | `api.morning.co` |
| **Path** | `/api/v1/account/token` | `/idp/v1/oauth/token` |
| **Body fields** | `id`, `secret` | `grant_type`, `client_id`, `client_secret` |
| **Response field** | `token` | `accessToken` |
| **Expiry** | not returned (we guessed 55 min) | `expiresAt`, Unix timestamp in **seconds** |

Auth has been split out into its own identity service. The `/account/token` path does not exist anywhere in the v2.0.0 spec.

### Verified against the spec

I downloaded the OpenAPI bundle and checked each claim directly rather than relying on the changelog:

- `/idp/v1/oauth/token` exists, and carries a per-operation `servers` override: `https://api.morning.co` (production) and `https://api.sandbox.morning.dev` (sandbox).
- `TokenRequest` lists `grant_type`, `client_id`, `client_secret` as **all required**. `grant_type` is an enum with the single value `client_credentials`.
- `TokenResponse` lists `accessToken`, `tokenType`, `expiresAt` as **all required**. `expiresAt` is `integer/int64`, described as *"Unix timestamp when this token expires"*.
- No `/account/token` path exists in the spec.

> **Note on conflicting vendor docs:** Morning's Hebrew help-center notice says only *"add `grant_type` to `id` and `secret`."* The OpenAPI spec says `client_id`/`client_secret` at a different host. **We are building to the spec** — it is the more detailed source and the one the developer docs site renders.

### What did NOT change

No action needed on any of these — all confirmed still correct:

- Base URL `https://api.greeninvoice.co.il/api/v1` (`lib/morning.ts:17`) — matches the spec's `servers` entry exactly
- Sandbox API URL `https://sandbox.d.greeninvoice.co.il/api/v1`
- `POST /documents` — same path
- Document type `400` = קבלה — confirmed in the `DocumentType` table
- Our `income[]` / `payment[]` / `client{}` shapes — match `IncomeRowRequest`, `PaymentRowRequest`, `CreateDocumentRequest`
- The error-2422 shipping-balance workaround (`lib/morning.ts:200`) — still needed
- Response handling — `id` and `url.he` / `url.en` still exist (`url` gained an `origin` field)

> The sandbox **IdP** host (`api.sandbox.morning.dev`) is a different domain from the sandbox **API** host (`sandbox.d.greeninvoice.co.il`). This is intentional on Morning's side; both are listed in the spec.

---

## 2.1 Live verification (2026-09-02)

I probed **both** auth endpoints with our current production credentials. This call only issues a token — it creates no document and sends no email.

| Endpoint | Result |
|---|---|
| **Legacy** `POST api.greeninvoice.co.il/api/v1/account/token` (what we ship today) | **HTTP 200** — still live. Returns `{ token, expires }`. |
| **New** `POST api.morning.co/idp/v1/oauth/token` (spec v2.0.0) | **HTTP 200** — works. Returns `accessToken`, `tokenType: "Bearer"`, `expiresAt`, valid for 60 minutes. |

Three conclusions that change the framing of this work:

1. **We are not currently down.** The legacy endpoint has not been switched off. Any receipt problems observed in production are *not* caused by this, and should be investigated separately. The earlier characterisation of this as an active outage was wrong — I had read the source note's *"when Morning blocks the old paths"* as present tense when it was conditional.

2. **Our existing production credentials work unchanged on the new endpoint.** `MORNING_API_KEY` / `MORNING_API_SECRET` are accepted directly as `client_id` / `client_secret`. No key reissue, no new secrets, no vault changes. This removes the main unknown from the migration.

3. **The new endpoint returns more than the spec documents.** The live response also included `scope`, plus snake_case aliases `access_token`, `token_type`, `expires_in`. We should read the **camelCase** `accessToken` / `expiresAt` fields, as those are the ones the spec declares `required`; the snake_case duplicates are undocumented and must not be relied on.

**What this means for scheduling:** this becomes planned maintenance rather than incident response. It should still ship — we are running on an endpoint that no longer exists in the vendor's own specification, and the failure mode when it is retired is silent and customer-facing — but it can go through normal review rather than a hotfix.

---

## 3. Changes to make

### 3.1 — Authentication `[REQUIRED — this is the outage]`

Replace `getAccessToken()` at `lib/morning.ts:93-127`.

```ts
const IDP_URL = process.env.MORNING_SANDBOX === 'true'
  ? 'https://api.sandbox.morning.dev/idp/v1/oauth/token'
  : 'https://api.morning.co/idp/v1/oauth/token'

const response = await fetch(IDP_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'client_credentials',
    client_id: apiKey,
    client_secret: apiSecret,
  }),
})

const data = await response.json()
cachedToken = data.accessToken           // was: data.token
tokenExpiresAt = data.expiresAt * 1000   // was: Date.now() + 55*60*1000
```

Two details that are easy to get wrong:

1. **`data.accessToken`, not `data.token`.** Miss this and we silently cache `undefined` and get a 401 on every document call — which looks like a *different* bug.
2. **`expiresAt` is in seconds — multiply by 1000.** Our existing 2-minute buffer at `lib/morning.ts:95` then works unchanged, and the hardcoded 55-minute guess at `:124` can be deleted. (The spec's example token has a 1-hour lifetime.)

Also update the log line at `lib/morning.ts:105`, which still prints `/account/token`.

Unchanged: the token cache, the 2-minute refresh buffer, and the 401-retry logic.

---

### 3.2 — Remove two unsupported payload fields `[RECOMMENDED]`

`CreateDocumentRequest` in the new spec has exactly these properties:

`description`, `remarks`, `footer`, `emailContent`, `type`, `date`, `dueDate`, `lang`, `currency`, `vatType`, `discount`, `rounding`, `signed`, `attachment`, `paymentRequestData`, `client`, `income`, `payment`, `linkedDocumentIds`, `linkedPaymentId`, `linkType`

We currently send two fields that are not on that list:

- **`amount`** (`lib/morning.ts:228`) — not a documented field. The document total is derived from `income[]`, which is precisely why error 2422 bit us. Safe to remove.
- **The whole `email: { to, lang, remarks }` object** (`lib/morning.ts:237-246`) — gone from the schema. Email delivery is now driven by `client.emails`, which the spec describes as *"the document download link will be sent to these addresses"*, with `emailContent` as the custom message body.

We already set both `client.emails: [customerEmail]` and `emailContent: remarksText`, so receipt emails should keep working after deleting the `email` block.

> ⚠️ **This is the one change with real customer-facing risk.** The spec does not set `additionalProperties: false`, so the server may currently be *honouring* our undocumented `email` block rather than ignoring it. We cannot tell which from the schema alone. See §6.

The now-dead debug log at `lib/morning.ts:264` (`'Full email object being sent'`) goes with it.

---

### 3.3 — Payment code for gift cards `[CORRECTNESS]`

The `PaymentGroup` table changed meaning. Our comments at `lib/morning.ts:29-46` describe the old table.

| Code | New spec meaning | Our mapping |
|---|---|---|
| 3 | כרטיס אשראי | `card` ✅ correct |
| 10 | אפליקציית תשלום (payment app) | `bit` ✅ now *more* accurate — Bit is a payment app |
| 11 | אחר (Other) | `gift_card` should move here |

`gift_card: 10` (`lib/morning.ts:40`) currently books gift cards as "payment app". It belongs on `11`.

> ⚠️ **This is not a one-character change.** The spec states `subType` is *"required when using 'other' as a Payment type."* Moving `gift_card` to `11` **without** adding `subType` risks turning a working call into a 400. The correct value exists and fits exactly: `OtherSubType` code **`4` = שובר מתנה** (gift voucher).
>
> So the change is `type: 11` **and** `subType: 4` — or we leave gift cards alone. A partial change is worse than no change.

**Bonus, optional:** `PaymentRowRequest` supports `appType`, where `PaymentAppType` code **`1` = Bit**. Since `bit` correctly maps to type `10` (payment app), adding `appType: 1` makes the ledger entry actually read "Bit" instead of an unspecified app. Free accuracy.

---

### 3.4 — `vatType` comments `[COMMENT FIX ONLY — do not change the values]`

An earlier review flagged our `vatType: 0` at `lib/morning.ts:188` and `:227` as possibly wrong, citing the `ItemVatType` table. **That review applied the wrong table to line 227.** The spec defines two separate enums:

| Enum | Used at | 0 | 1 | 2 |
|---|---|---|---|---|
| `DocumentVatType` | `:227` (document level) | Default (based on business type) | **Exempt (VAT-free)** | Mixed |
| `ItemVatType` | `:188` (line-item level) | Default (VAT added based on business type) | Included (VAT included in price) | Exempt |

Setting the **document-level** field to `1` would mark our receipts **VAT-exempt** — a real accounting defect, not a cleanup.

**Both values stay at `0`.** Only the comments change:

- `:227` currently says `// VAT included in price` → should read `// DocumentVatType 0 = Default (based on business type)`
- `:188` currently says `// Default VAT included` → should read `// ItemVatType 0 = Default`

Receipts have been coming out with correct totals, so `0` is behaving as intended on both. The comments were simply describing the wrong thing.

---

### 3.5 — Environment variables `[HOUSEKEEPING]`

No new secrets. `MORNING_API_KEY` / `MORNING_API_SECRET` become the OAuth `client_id` / `client_secret`.

However, **none of the `MORNING_*` vars are in `.env.example`** — they exist only in the live `.env`. Adding them while we're in here:

```
# Morning (Green Invoice) receipts
MORNING_API_KEY=your_morning_api_key
MORNING_API_SECRET=your_morning_api_secret
# true = sandbox (requires separate sandbox-issued credentials)
MORNING_SANDBOX=false
```

The spec is explicit: *"Each environment requires its own set of API keys."* Sandbox and production credentials are **not** interchangeable.

---

## 4. Summary of edits

| # | Change | File / lines | Priority | Risk |
|---|---|---|---|---|
| 1 | OAuth token endpoint | `lib/morning.ts:93-127`, log at `:105` | **Blocking** | Low — verified live, §2.1 |
| 2 | Remove `amount` | `lib/morning.ts:228` | Recommended | Low |
| 3 | Remove `email{}` block + debug log | `lib/morning.ts:237-246`, `:264` | Recommended | **Medium — affects email delivery** |
| 4 | `gift_card` → `type: 11` + `subType: 4` | `lib/morning.ts:40` + payload | Correctness | Low, *if* `subType` is included |
| 5 | `appType: 1` for Bit | payload | Optional | None |
| 6 | Fix `vatType` comments (no value change) | `lib/morning.ts:188`, `:227` | Cosmetic | None |
| 7 | Add `MORNING_*` to `.env.example` | `.env.example` | Housekeeping | None |

---

## 5. Rollout order

1. Fix auth (#1) — the only blocking item. ✅ Already proven to work against live production credentials (§2.1).
2. Apply the low-risk items: `gift_card` + `subType` (#4), `appType` (#5), comment fixes (#6), `.env.example` (#7).
3. Remove `amount` and `email{}` (#2, #3) — **the risky pair**, gated on the Q2 decision below.
4. Run `npx tsx scripts/test-morning-flow.ts` (per `test-command.md`) and **confirm the receipt email actually arrives**.
5. Run one live checkout through a real flow as a final smoke test.

> **Note:** step 4 is currently the untested gap. The end-to-end script has not been run — it creates real documents against production, so it is gated on Q2. Everything above the line in §2.1 was verified with a side-effect-free token call only.

---

## 6. Decisions needed from the lead

### Q1 — Do we have sandbox API keys? ✅ RESOLVED — no longer blocking

Confirmed on 2026-09-02: our **production** credentials authenticate against the production IdP (`api.morning.co`) with no changes. No key reissue is needed to ship this.

Sandbox keys would still be needed to exercise the flow against `api.sandbox.morning.dev` (the spec is explicit that keys are per-environment), but that is now a *nice-to-have for testing*, not a prerequisite for the migration. See Q2 for why sandbox may not be worth chasing.

### Q2 — Are we OK with one live production test?

This is now the **only** open question. Authentication is proven working end-to-end (§2.1). What remains unverified is document creation and, critically, **whether the receipt email still reaches the customer once we remove the undocumented `email{}` block** (change #3).

Even with sandbox access, **sandbox environments commonly do not dispatch real email.** A green sandbox run would confirm the token and the document creation, but may *not* prove that a receipt actually lands in an inbox — which is the single thing we most need to confirm.

**Recommendation:** land changes #1–#7, then run `scripts/test-morning-flow.ts` once against **production**. Note it runs twice by design (once `en`, once `he`), so that is **two** real receipts, emailed to the address hardcoded in the script. Cost: two live documents in the ledger. Benefit: it definitively settles the email question, which is the only part of this migration the spec cannot answer.

**Lower-risk variant:** temporarily reduce the script to a single language run, so we spend one document instead of two.

**Alternative, if any live document is unacceptable:** ship #1 alone. Auth is a drop-in swap with no visible behaviour change, and it de-risks the deprecation. Then defer #2–#3 (the `amount` / `email{}` removals) to a follow-up once we have sandbox credentials and can confirm email behaviour there. This is the conservative path and I would not argue against it.

---

## 7. Sources

- <https://developers.morning.co/> — developer docs
- <https://developers.morning.co/docs/openapi.bundled.json> — **the authoritative source**; raw OpenAPI 3.0.3 spec, version 2.0.0. Everything cited above regarding `/idp/v1/oauth/token`, `CreateDocumentRequest`, `PaymentGroup`, `OtherSubType`, `PaymentAppType`, `DocumentVatType`, and `ItemVatType` comes from this file.
- <https://www.greeninvoice.co.il/help-center/api-updates-26/> — Hebrew change notice (less detailed; conflicts with the spec, see §2)
- <https://www.greeninvoice.co.il/help-center/generating-api-key/> — issuing API keys
- <https://www.greeninvoice.co.il/help-center/api/> — general API help

To re-verify independently:

```bash
curl -s https://developers.morning.co/docs/openapi.bundled.json -o morning-openapi.json
```
