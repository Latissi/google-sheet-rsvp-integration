# Copilot Instructions — Hybrid RSVP System (Google Sheets + Apps Script)

This repository implements a **hybrid RSVP workflow** for club training management using only Google-native tools.

## 1. Core Architecture & Mental Model
The system follows a **Clean Architecture / Ports & Adapters** pattern to decouple core domain logic from Google-specific APIs.
- **Single Source of Truth:** The "Public Training Sheet" for sessions/attendance.
- **Sensitive Data Isolation:** All PII (emails, roles) and system configs reside in a **Private "User & Config" Sheet**.
- **Domain Layer (`Services/`):** Contains pure logic (`RegistrationManager`, `RsvpManager`, `NotificationManager`).
- **Adapter Layer (`Adapters/`):** Implements system interfaces for `MailApp`, `SpreadsheetApp`, and `PropertiesService`.
- **Flow:** `Trigger/Webhook` -> `Adapter` -> `Inbound Port (Service Interface)` -> `Domain Logic` -> `Outbound Port` -> `Persistence/Notification Adapter`.

## 2. Essential Configuration & Secrets
Environment-dependent values must NEVER be hardcoded. Use `config.ts` which wraps `PropertiesService`.
- **Required keys:** `PRIVATE_SHEETS_ID`, `WEBAPPURL`.
- **Validation:** Always use typed config accessors that throw early if keys are missing.

## 3. Development & Testing Workflow
Since Google APIs only run in the cloud, follow the multi-tier test strategy:
- **Local Logic:** Test domain managers using `Jest` by mocking the Port interfaces (e.g., `IMailProvider`).
- **Cloud Staging:** Use `clasp` to push to a separate "Dev" Apps Script project linked to a duplicate "Sandbox" Sheet.
- **Safety Safeguard:** All email dispatch must pass through a wrapper that checks `ENV === 'prod'`. In `dev`, redirect all outgoing mail to the `TRAINER_EMAIL`.

## 4. Coding Standards & Constraints
- **Zero Cost:** No 3rd party APIs (Twilio, SendGrid, etc.). Use only `GmailApp`/`MailApp`.
- **Quota Awareness:** Respect the 100 emails/day limit. Implement batching or specific trainer-only alerts where possible.
- **Privacy:** Never log PII (emails/names) to stackdriver/cloud logs. Use internal `memberId` for tracing.
- **Types:** Use explicit interfaces for data models (see `types.ts`).

## 5. File Referencing Rules
- **Logic:** `src/domain/` (Business rules)
- **Infrastructure:** `src/infrastructure/` (Google API wrappers)
- **Config:** `src/config.ts`
- **Architecture Docs:** [docs/5_Building_Block_View/building_block_lvl_2_services.puml](docs/5_Building_Block_View/building_block_lvl_2_services.puml)

## 6. Definition of Done
- Port interfaces defined for any new external dependency.
- Staging-ready (works with sandbox Sheet IDs).
- Unit tests added for new domain logic.
- Public Sheet UX is preserved (no breaking changes to trainer's view).

