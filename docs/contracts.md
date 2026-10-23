# Contracts v1.0 (approved by the owner on 21 Oct 2026)
Changes after approval are made as new dated revisions and logged in `decisions.md`. Numeric limits are starting values to be measured, not promises. Project-level membership is not modelled yet (D-14), so in Contract E every org member currently sees every project in the org.

## A. Event Schema v1
Envelope (JSON, language-neutral):
`schema_version` (1), `event_id` (client UUID, idempotency key), `type` (`error` | `custom` | `http` | `log`), `name`, `severity` (`debug|info|warning|error|fatal`), `occurred_at` (client time, ISO 8601), `received_at` (server-set, never trusted from client), `environment` (resolved from the ingestion key, not the payload), `trace_id`, `span_id`, `attributes` (flat key/value), `error` (optional: `type`, `message`, `stack`), `sdk` (`name`, `version`, `language`).
Rules: project and environment come from the key only. Reject malformed, unauthorized and oversized events with clear status codes. Duplicate `event_id` per project is accepted once and not billed twice. Server redacts known sensitive keys (password, token, secret, authorization, card numbers) before persistence. Unknown top-level fields are rejected, so the schema stays strict.
Proposed limits: event 32 KB; batch 100 events or 512 KB; 64 attributes; key 64 chars; string value 2,048 chars; `occurred_at` within -7 days / +5 minutes of server time.
Ingestion keys: prefix `cdx_` plus random secret, shown once, stored only as a hash, scoped to one project and environment, revocable and rotatable. Separate from admin credentials.

## B. Payment Event Contract
Two layers. `payments.deliveries`: raw provider webhook (headers, body, signature result, received time), never edited. `payments.events`: normalized record with `id`, `project_id`, `provider` (`paystack|stripe`), `provider_account_id`, `provider_event_id`, `provider_txn_ref`, `type` (`payment|refund|dispute|subscription|payout`), `status`, `amount_minor` (integer), `currency` (ISO 4217), `fee_minor` (null unless verified), `occurred_at`, `processed_at`, `dedup_key` (`provider:account:event_id`, unique), `related_event_id`.
Rules: delivered is not processed and not succeeded. Reject deliveries that fail signature verification (and replay checks where the provider supports it). Handle duplicates and out-of-order delivery. Reconciliation against the provider API recovers misses. Revenue is shown per currency and period, never converted or summed across currencies. Customer payment monitoring stays separate from Codex's own billing. VERIFY current Paystack and Stripe webhook and signature docs before building.

## C. Module Registry
Each module declares: `id`, `name`, `version`, `status` (`available|planned`), `nav` items, `widgets` (id, size, data source, required capability), `config_schema`, `permissions`, `event_types`, `depends_on`, `required_capabilities`. Navigation and dashboard widgets are generated only from enabled modules. Per-project table `core.project_modules` stores enabled modules and config. Launch modules: `monitor`, `mail`. Others are listed as planned and not clickable.

## D. Capability State Machine
States: `not_configured`, `setup_required`, `verifying`, `connected`, `degraded`, `disconnected`.
Transitions: not_configured to setup_required (module enabled); setup_required to verifying (user starts test); verifying to connected only after a real test operation succeeds, otherwise back to setup_required with a reason; connected to degraded after repeated failures or staleness; degraded to disconnected only after a sustained window (proposed: 15 minutes of failures); degraded or disconnected to verifying on retry or recovery. A single timeout never disconnects a healthy integration. Each state change stores `reason`, `changed_at`, `last_success_at`, `last_error`.

## E. Roles and Permissions
Customer org roles: `owner`, `admin`, `developer`, `viewer`. Owner: everything including billing and org deletion. Admin: members, projects, integrations, alerts, no org deletion. Developer: view data, manage alerts and ingestion keys for projects they belong to, no billing, no payment credentials. Viewer: read-only, no keys, no payment credentials. Payment data and credentials: owner and admin only by default. Every row carries `org_id` and is protected by RLS keyed on membership. Codex staff roles (`admin` schema) are separate and never grant access to customer data without an audited support action.

## F. Notifications and Usage
Channel interface: `send(alert, destination) -> {status, attempt, error?}`. Channels at launch: in-app and outgoing webhook (signed with a per-channel secret). Codex Mail added later through the same interface. Every attempt is stored (`pending|sent|failed|gave_up`); failures stay visible and are never shown as delivered. Retries with backoff, alert dedup by fingerprint, cooldown per rule. Usage: count accepted, valid, persisted events per project per month; warn at 80%; at 100% apply the plan's hard cap or paid overage, never a silent charge. AI credits live in a separate ledger with pre-request budget checks and locking so concurrent requests cannot overspend.

## Implementation notes from Slice 3 (not changes to the approved text)
- Contract A: strict field list; unknown fields (including `received_at`, `environment`, `project_id`) are rejected. Redaction covers sensitive key names, bearer tokens, JWTs, Codex keys and card numbers that pass a Luhn check. Error fingerprint = error type + message with numbers and ids removed + top stack frame without line numbers.
- Contract D: derived on read, no stored history yet (see D-18).
- Contract E: developers manage keys and error status; viewers read errors but cannot see keys; usage rows are visible to owners and admins only.
- Contract F: usage counts accepted, valid, stored events per project per month; the 80% warning and AI credits are not built.

