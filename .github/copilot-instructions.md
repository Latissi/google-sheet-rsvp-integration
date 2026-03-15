# Copilot Instructions — Hybrid RSVP System (Google Sheets + Apps Script)

This repository implements a **hybrid RSVP workflow** for club training management using only Google-native tools.

## 1. Architecture
The system follows a **Clean Architecture / Ports & Adapters** pattern.
- **Domain:** `src/domain/` contains pure models and port interfaces. Keep Google-specific APIs out of this layer.
- **Application:** `src/application/` contains use-case services such as registration, RSVP, reminders, cancellations, and trainer reports.
- **Infrastructure:** `src/infrastructure/adapters/` and `src/infrastructure/gateway/` contain Google Sheets, Mail, and private-sheet implementations.
- **Runtime:** `src/runtime/` wires the application for Apps Script entry points. `src/runtime/createRuntimeContext.ts` is the main composition root.
- **Single Source of Truth:** The public training sheet is the attendance source of truth; private sheets hold config, identities, roles, and subscriptions.

## 2. Build And Test
- Install dependencies with `npm install`.
- Run tests with `npm test`.
- Build with `npm run build`.
- Deploy to Apps Script dev/prod projects with `npm run push:dev` and `npm run push:prod`.
- Prefer running Jest locally for logic changes; Google APIs should stay behind adapters and mocks.

## 3. Configuration Model
There is **one supported configuration path**. Do not add fallback or compatibility branches.
- Script Properties required by `src/config.ts`: `ENV`, `PRIVATE_SHEETS_ID`, `WEBAPPURL`, `TRAINER_EMAIL`.
- Private sheet tabs are canonical and fixed: `Konfiguration`, `Trainingsquellen`, `Trainingsdefinitionen`, `Mitglieder`.
- `Konfiguration` accepts the German keys `OEFFENTLICHES_SHEET_ID`, `WEBAPP_ADRESSE`, and `ERINNERUNGS_OFFSETS`.
- Public training sources are configured only through the structured tabs `Trainingsquellen` and `Trainingsdefinitionen`.
- The public sheet supports only the `member-rows` layout.
- Registration accepts only `action=register` plus `email`, `role`, `gender`, `firstName`, and `lastName`.
- Use the docs in `docs/SCHEMA_GUIDE.md` and `docs/DEV_RUNBOOK.md` as the canonical setup reference.

## 4. Conventions
- Add new external integrations behind explicit port interfaces in `src/domain/ports/`.
- Keep tests at the service or adapter boundary by mocking ports or `ISheetGateway`; do not call `SpreadsheetApp` or `MailApp` in tests.
- All mail sending must continue to flow through `EnvironmentAwareNotificationSender` so `dev` redirects to `TRAINER_EMAIL`.
- Never log PII. Use `src/runtime/logging.ts` and prefer `memberId` over names or emails in log context.
- User identity is derived from `firstName + lastName` and normalized into a composite `memberId`.
- Use German-facing sheet keys, headers, and role values. Canonical role values are `Mitglied` and `Trainer`.

## 5. Safety And Done Criteria
- Use only Google-native services already present in the project; do not introduce third-party messaging or mail providers.
- Respect email quota constraints and prefer trainer-targeted notifications over broad fan-out when changing notification flows.
- For code changes, update tests when behavior changes.
- For configuration or sheet-shape changes, keep the schema docs and runbook in sync.

## 6. Key Files
- `src/runtime/createRuntimeContext.ts`
- `src/config.ts`
- `src/infrastructure/adapters/ConfigurationAdapter.ts`
- `src/infrastructure/adapters/GoogleSheetTrainingDataRepository.ts`
- `docs/SCHEMA_GUIDE.md`
- `docs/DEV_RUNBOOK.md`

