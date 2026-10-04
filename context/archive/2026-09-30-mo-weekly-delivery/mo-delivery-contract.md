# MO → mo-web Weekly Delivery: Requirements for Meal Orchestrator

> Audience: whoever implements the sending side in the `meal-orchestrator` repo.
> Source of truth for the payload is `moDeliverySchema` in mo-web's `src/lib/mo-delivery.ts`; this document is kept in sync with it. A valid example is mo-web's `scripts/fixtures/mo-delivery.sample.json`.
> Roadmap: mo-web S-01 (`mo-weekly-delivery`), issue malpiszon/meal-orchestrator-web#4.

## Goal

After MO emails a user's weekly recommendation, it also delivers the same week to mo-web: the full menu plus every variant's score, so mo-web can keep plan history and later let the user swap meals within that menu.

The PRD guardrails apply:

- MO's recommendation logic doesn't change. Delivery to mo-web is an additional step alongside the email, not a replacement.
- A mo-web failure must never affect the email or anything else MO does.

## Endpoints

There are two mo-web environments, and each has its own endpoint and token:

| Environment | Endpoint URL                                                                                                                                      | Token on the mo-web side                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| dev         | `http://localhost:4321/api/mo/deliveries` (the mo-web dev server, `npm run dev`; use `http://host.docker.internal:4321/…` when MO runs in Docker) | `MO_INGEST_TOKEN` in mo-web's `.dev.vars` |
| prod        | `https://mo-web.malpiszon.workers.dev/api/mo/deliveries`                                                                                          | `MO_INGEST_TOKEN` Worker secret           |

- Method `POST`, with headers:
  - `Content-Type: application/json`
  - `Authorization: Bearer <token>`
- **The endpoint goes in MO's config file**, not in code or an environment variable. Each MO deployment (dev or prod) uses its own `--config` file, which points at the matching mo-web environment. See "Configuration" below.
- **The token stays out of the config file.** MO keeps secrets in environment variables and the config names the variable, the same way `operational_discord_webhook_env` works. Each environment gets its own random token (64 hex chars, generated with `openssl rand -hex 32` and handed over by mo-web's operator). A dev token never works against prod, and vice versa.
- One request per user per run.

## Payload (schema_version 1)

```json
{
  "schema_version": 1,
  "run_id": "3f2c9a…",
  "provider": "ntfy",
  "week_start": "2026-10-05",
  "week_end": "2026-10-09",
  "user": { "email": "user@example.com" },
  "days": [
    {
      "date": "2026-10-05",
      "meals": [
        {
          "type": "breakfast",
          "variants": [
            {
              "provider_meal_id": "496",
              "name": "Kofty z miętą i pietruszką, sos jogurtowy…",
              "composition": "…",
              "nutrition": {
                "protein_g": 23.8,
                "fat_g": 27.4,
                "saturated_fat_g": 12.9,
                "carbs_g": 6.7,
                "sugar_g": 1.3,
                "fiber_g": 1.1,
                "salt_g": 2.0
              },
              "score": 8,
              "justifications": [{ "icon": "🥗", "text": "…" }]
            }
          ]
        }
      ]
    }
  ]
}
```

| Field                             | Source in MO                                                                      | Rules                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schema_version`                  | constant                                                                          | Must be `1`.                                                                                                                                                                                                                                                                                                                                                                               |
| `run_id`                          | `orchestrator.py` `run_id` (uuid4 hex)                                            | Optional string; stored for tracing. Leave it out rather than sending `null`.                                                                                                                                                                                                                                                                                                              |
| `provider`                        | `CanonicalMenu.provider`                                                          | Non-empty string.                                                                                                                                                                                                                                                                                                                                                                          |
| `week_start` / `week_end`         | `CanonicalMenu.week_start` / `week_end`                                           | ISO dates; `week_start` is a Monday; `week_end` is between `week_start` and `week_start + 6`. MO always sends `week_start + 4`. The CLI's `--week-start` accepts any date (`cli.py:21`); a non-Monday value is expected to email normally, then get a 400 and an ops alert. No CLI check is required.                                                                                      |
| `user.email`                      | `UserConfig.email`                                                                | A valid email address; matched case-insensitively to an existing mo-web account, which is created if there is none (see Responses).                                                                                                                                                                                                                                                        |
| `days[].date`                     | `CanonicalDay.date`                                                               | ISO date (`YYYY-MM-DD`); unique; within `[week_start, week_end]`. At least one day: an empty `days` is rejected, because a delivery replaces the stored week.                                                                                                                                                                                                                              |
| `meals[].type`                    | `CanonicalMeal.type`                                                              | One of `breakfast, second_breakfast, lunch, tea, dinner, snack`; unique within a day. Every day has at least one meal.                                                                                                                                                                                                                                                                     |
| `variants[]`                      | `CanonicalMeal.variants` joined with `MealAssessment.variants` by `variant_index` | 1–10 per meal, **in the menu's original order**. Don't sort by score: mo-web's tie rule (the first-listed option wins) depends on this order.                                                                                                                                                                                                                                              |
| `variants[].provider_meal_id`     | **new:** raw `configurable_product_id` as a string                                | Required; unique within a meal; must be the dish-level ID that stays the same across weeks and sizes (not `simple_product_id`, not the name). mo-web keys meals **only** by (`provider`, `provider_meal_id`).                                                                                                                                                                              |
| `variants[].name` / `composition` | `MealVariant.name` / `composition`                                                | `name` is required and non-empty. `composition` is a string, and `""` is accepted: MO sends it as-is and mo-web stores an empty value as "no composition". Both are **display text**. The same `provider_meal_id` can arrive under a different name in another week (e.g. ID `2654` has a German and a Polish name in the fixtures); mo-web shows the latest name and never matches on it. |
| `variants[].nutrition`            | `MealVariant.nutrition`                                                           | Optional object with the keys `protein_g`, `fat_g`, `saturated_fat_g`, `carbs_g`, `sugar_g`, `fiber_g`, `salt_g`; each optional and a number. Leave out unknown values instead of sending `null` (a `null` is rejected), as `to_compact_dict()` already does. Leave the whole object out when it would be empty.                                                                           |
| `variants[].score`                | `VariantAssessment.score`                                                         | Integer 1–10.                                                                                                                                                                                                                                                                                                                                                                              |
| `variants[].justifications`       | `VariantAssessment.justifications`                                                | 0–5 `{icon, text}` objects; both are strings.                                                                                                                                                                                                                                                                                                                                              |

Unknown top-level keys are rejected (HTTP 400). Unknown keys inside nested objects (`user`, days, meals, variants, `nutrition`) are not rejected but are ignored; mo-web only keeps them in the stored raw payload. Extending the payload therefore means bumping `schema_version` in coordination with mo-web.

All date checks use the calendar date as written, with no time zone involved.

## Configuration

New optional section in `config/app*.yaml`, parsed into a new `MoWebDeliveryConfig` on `DeliveryConfig` (`config/models.py:52-54`) by `config/loader.py`:

```yaml
delivery:
  email_from: "Meal Orchestrator <meals@example.com>"
  operational_discord_webhook_env: "DISCORD_OPS_WEBHOOK_URL"
  mo_web:
    url: "https://mo-web.malpiszon.workers.dev/api/mo/deliveries" # dev config: http://localhost:4321/api/mo/deliveries
    token_env: "MO_WEB_TOKEN" # name of the env var holding this environment's token
    timeout_seconds: 10
```

- `url` is required when `mo_web` is present. Reject anything that isn't `https://`, unless the host is `localhost`, `127.0.0.1` or `host.docker.internal`.
- `token_env` is required when `mo_web` is present. If the variable it names is unset at startup, log a warning and skip the mo-web step. Don't fail the run: email must still go out.
- `timeout_seconds` defaults to 10.
- When the section is left out, the delivery step doesn't run. Add it to `config/app.example.yaml` using the dev URL.
- Log the environment's URL (never the token) at the start of each delivery, so the operator can see which mo-web a run targeted.

## Responses and retry policy

| Status                                 | Body                                                                                  | Meaning                                                                                                                                                                  | MO should                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 200                                    | `{"plan_id","week_start","account_created"}`                                          | Stored. A re-sent week replaces the earlier one. A new email becomes an account first (`account_created: true`); mo-web sends that user an invitation; a failed email is only logged and doesn't change the response.           | Done. Optionally log `account_created`.                                                |
| 400                                    | `{"error":"invalid_payload","issues":[{"path":"days.0.meals.1.type","message":"…"}]}` | Contract violation, a body that isn't JSON, or a string Postgres can't store (`\u0000`). `path` is the dotted location of the offending field (`""` for the whole body). | Not retry; alert the operator with `issues`.                                           |
| 401                                    | `{"error":"unauthorized"}`                                                            | Wrong or missing token                                                                                                                                                   | Not retry; alert.                                                                      |
| 403                                    | `Cross-site POST form submissions are forbidden` (plain text)                         | The request wasn't sent as `Content-Type: application/json`, so mo-web's framework treated it as a cross-site form post and rejected it before the endpoint ran          | Not retry; fix the client to send `Content-Type: application/json`, alert.             |
| 413                                    | `{"error":"payload_too_large"}`                                                       | Body over 256 KB (a normal week is about 40 KB)                                                                                                                          | Not retry; alert.                                                                      |
| 500                                    | `{"error":"storage_failed"}`                                                          | mo-web couldn't store the week or create the account; details are in mo-web's logs                                                                                       | Retry with backoff (below), then alert.                                                |
| 503                                    | `{"error":"not_configured"}`                                                          | mo-web's secrets are missing (a deploy problem)                                                                                                                          | Retry with backoff (below), then alert.                                                |
| 429, other 5xx, network error, timeout | —                                                                                     | Transient                                                                                                                                                                | Retry with backoff via `retries.with_retries` + `is_transient_http_error`, then alert. |

mo-web checks in this order: configuration (503), token (401), body size (413), payload (400), storage (500). Every response body from the endpoint is JSON; the 403 above comes from the framework before the endpoint runs.

**Idempotency:** a delivery for the same (email, `week_start`) replaces the stored week, so repeating a request is always safe, whether it's an automatic retry or a manual one.

## Changes required in MO

> **Status:** already implemented in `meal-orchestrator` (commit `fd3748e` "Deliver each user's weekly plan to mo-web", merged as PR #65 at `45616ab`), and its payload builder matches `moDeliverySchema`. This section stays as the reference for what MO must keep doing.

1. **Carry the meal ID through normalization.**
   - Add a required `provider_meal_id: str` to `MealVariant` (`domain/models.py:51-65`). It has to go **before** `nutrition`, which has a default, or the dataclass won't compile. Update every `MealVariant(...)` call site (11 files, including `tests/unit/helpers.py` and the rendering, prompt and LLM-output tests).
   - Set it in `providers/ntfy/normalizer.py` `_to_meal_variant` (around lines 180-199) from the group's `configurable_product_id`. The normalizer already groups by that ID (lines 78-108).
   - Decide whether it appears in `to_compact_dict()`, i.e. the LLM prompt. Excluding it keeps prompts and costs unchanged.
   - Example provider: add a required `id` field to the example raw format and to `tests/fixtures/provider_menu_raw.json`, and map it in `example_provider.py`. The same dish in different sizes (`M: "Tortilla"`, `XL: "Large tortilla"`) gets the same `id`. Don't derive the ID from the name.
2. **Add a mo-web delivery client.**
   - Create `delivery/mo_web.py`, sitting behind a Protocol in `delivery/__init__.py` like the email client.
   - It builds the payload above from `CanonicalMenu` + `WeekAssessment` + `UserConfig.email` + `run_id`, reusing `rendering/join.py` iterators for the menu ↔ assessment join.
   - It sends with `http.post_json` (`http.py:7-15`) wrapped in `with_retries`.
   - Configured by the `delivery.mo_web` section of the app config (see "Configuration"). The client is built in `orchestrator._build_shared_clients` only when that section is present and its token variable is set, the same way the email client depends on `RESEND_API_KEY`.
3. **Add a best-effort delivery step.**
   - It runs as the **last** step, after `_deliver_email` and `_notify_plan_ready`, in both `workflow.execute_from_menu` and `workflow.execute_from_llm_result` (the batch path; the fallback in `batch_coordinator._deliver` goes through `execute_from_menu`).
   - It **never sets `state.failed_step`**, so an earlier failure is always reported under the right step.
   - A failure is logged at warning level and never re-raised, like `_notify_plan_ready`. The run status doesn't change.
   - It also runs when email was skipped because `RESEND_API_KEY` is unset (`workflow.py:467`). That's intended: mo-web's copy doesn't depend on email.
   - Skipped in dry-run, like the existing channels.
4. **Tell the operator about failures.**
   - On a final failure (non-retryable status, or retries exhausted), post to the ops Discord webhook via `ops_notifications.notify_safely`.
   - Include the user id, `week_start`, the HTTP status, and mo-web's `error`/`issues`. The body is available from `HTTPError.response_body`, and after retries from `RetryError.last_exception`.
   - Truncate `issues` so the alert fits Discord's 4096-character embed limit: list the first few issues and append "… and N more". The full list goes to the log and the saved payload artifact (step 5).
   - Never include the token. The email may appear, since the ops channel is private.
5. **Save the payload as an artifact.**
   - Add `RunArtifacts.save_mo_web_payload()` that writes `mo_web_payload.json` (the exact request body, never the token) to the run's user directory, next to `canonical_menu.json`.
   - Write it before sending, so it exists even when delivery fails. It's what the operator re-POSTs for a manual retry, and it keeps the IDs that `canonical_menu.json` lacks when `provider_meal_id` stays out of `to_compact_dict()`.
6. **Tests.**
   - Normalizer: `provider_meal_id` is populated and stable across the `raw_offer6_*` / `raw_offer8_*` fixtures. For example, "Kofty z miętą…" gives `"496"` in both.
   - Payload builder: menu order is preserved and scores are joined.
   - Workflow: a mo-web failure leaves the email delivered and the user's result successful, and `failed_step` untouched.
   - Artifacts: `mo_web_payload.json` is written, contains `provider_meal_id`, and contains no token.
   - Alerts: a long `issues` list is truncated under 4096 characters.

## Manual retry (operator)

Both options are safe for mo-web because of the idempotency rule above:

1. **Preferred: re-POST the saved payload.** Send `<artifacts>/<run_id>/<user_id>/mo_web_payload.json` with `curl -X POST <url> -H "Authorization: Bearer $MO_WEB_TOKEN" -H "Content-Type: application/json" --data @mo_web_payload.json`. The user gets no extra email. It only works while the artifact is kept (`artifacts.retention_days` / `max_runs`).
2. **Re-run MO for that user and week** (`--week-start`). This **sends the user a second email**: the email idempotency key contains `run_id` (`workflow.py:482`), and a new run gets a new `run_id`. It also asks the LLM again, so scores may differ from the first email.

## Out of scope for MO

- Any change to recommendation, scoring or email content.
- Sending calories or other raw fields that the normalizer drops today.
- mo-web → MO integration.
