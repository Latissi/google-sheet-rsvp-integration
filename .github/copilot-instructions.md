# Copilot Instructions — Hybrid RSVP System (Google Sheets + Apps Script)

This repository implements a **hybrid RSVP workflow** for club training management using only Google-native tools.

Canonical requirements and constraints are documented in [docs/requirements-and-constraints.md](../docs/requirements-and-constraints.md).

## 1) Product Goal

Keep the existing Google Sheet as the trainer’s primary frontend while enabling:

- low-friction member onboarding,
- automated weekly reminders,
- one-click RSVP via e-mail and/or calendar,
- synchronization of RSVP data back into the training sheet,
- one-action training cancellation broadcasts,
- strict contact privacy.

## 2) Required Architecture

Keep code modular and domain-oriented. Avoid monolith scripts.

- `config.ts`: property access, constants, environment-aware configuration
- `sheet.ts`: sheet read/write logic, mapping members/sessions/attendance cells
- `mail.ts`: reminder/cancellation e-mail generation and dispatch
- `calendar.ts`: event creation/lookup and RSVP status ingestion

Additional allowed modules:
- `form.ts` for onboarding processing
- `webapp.ts` for RSVP link handlers (`doGet` / `doPost`)
- `scheduler.ts` for time-based orchestration
- `types.ts` for shared types/enums/interfaces

## 3) Data Model Guidance

Use stable keys and explicit schema comments in code.

- `memberId` (deterministic or generated)
- `fullName`
- `email`
- `channelPreference` (`EMAIL` | `CALENDAR` | `BOTH`)
- `active` flag
- timestamps: created/updated

RSVP records should include:

- `trainingSessionId` (or date key)
- `memberId`
- `status` (`YES` | `NO` | `UNKNOWN`)
- `source` (`MAIL_LINK` | `CALENDAR` | `MANUAL`)
- `updatedAt`

## 4) Configuration & Secrets

All environment-dependent values come from script properties, for example:

- `ENV` (`dev`/`prod`)
- `SHEET_ID`
- `BACKEND_SHEET_NAME`
- `TRAINING_SHEET_NAME`
- `FORM_ID`
- `CALENDAR_ID`
- `WEBAPP_BASE_URL`
- `TRAINER_EMAIL`

Rules:
- Never commit real IDs/tokens to source.
- Provide typed config accessors with validation and fail-fast errors for missing required keys.

## 5) Development Workflow (Local)

- Develop in TypeScript via VS Code + `clasp`.
- Use branch strategy:
	- `develop` → staging deployment,
	- `main` → production deployment.
- Use separate Apps Script projects/resources for dev vs prod.
- Test flows with alias e-mails (`name+alias@...`) to simulate multiple members.

## 6) Coding Standards for This Repo

- Keep functions small, explicit, and single-purpose.
- Prefer pure transformation helpers for mapping/parsing logic.
- Centralize enum/string literals in shared types/constants.
- Validate all externally sourced input (Form payload, webapp query params, sheet values).
- Avoid hidden behavior; document assumptions in concise module-level comments.

## 7) Expected Operational Flows

Implement and preserve these flows:

1. Form submit → member registered in sheet + backend DB.
2. Weekly trigger → reminders sent via configured channels.
3. Mail RSVP click → webapp receives action → sheet sync update.
4. Calendar RSVP update/read → sheet sync update.
5. Cancellation trigger detected → cancellation e-mail broadcast.

## 8) AI Agent Implementation Rules

When generating or editing code in this repository:

- Always preserve the Google Sheet-centric trainer UX.
- Do not introduce third-party dependencies without explicit instruction.
- Keep environment-aware behavior in `config.ts` and properties, not inline constants.
- Do not leak e-mail addresses in logs, comments, sample data, or tests.
- Favor minimal, targeted changes over broad refactors.
- If a requirement is ambiguous, implement the simplest behavior consistent with the brief and leave a clear TODO marker.

## 9) Definition of Done (Feature-Level)

A feature is considered done only when:

- code is modularized by domain,
- staging-safe configuration is used (no hardcoded IDs),
- privacy constraints are respected,
- manual fallback remains possible,
- and the change is testable in staging with predictable outcomes.

