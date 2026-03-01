# Requirements and Constraints — Hybrid RSVP System

This document centralizes the project requirements and constraints for the hybrid RSVP workflow.

## Functional Requirements

### FR-1 Member Onboarding
- Provide a single, low-friction Google Form for member registration.
- Capture at minimum: full name and e-mail address.
- Capture preferred RSVP channel: `EMAIL`, `CALENDAR`, or `BOTH`.
- On submit:
  - write member name into trainer-visible training sheet,
  - write e-mail and channel preference into hidden backend tab.

### FR-2 Weekly Training Reminder
- Send automated weekly reminders before each training session.
- Deliver per member preference:
  - e-mail reminder with RSVP actions,
  - calendar invitation,
  - or both.

### FR-3 One-Click RSVP
- Support one-click confirm/decline via e-mail link to Apps Script Web App.
- Support one-click confirm/decline via Google Calendar attendee response.
- Members must never need direct access to the training sheet to RSVP.

### FR-4 Sheet Synchronization
- Synchronize RSVP outcomes from mail and calendar into attendance cells.
- Manual trainer edits remain possible at all times.
- Do not overwrite manual values unless a newer explicit RSVP is received after the manual edit.
- Maintain deterministic conflict handling using source + timestamp metadata.

### FR-5 Training Cancellation Notification
- Allow trainer-triggered cancellation via a single sheet action (e.g., control cell/checkbox).
- Send cancellation e-mail to all registered members.
- Optionally mark or cancel corresponding calendar event.

### FR-6 Contact Data Access
- Restrict e-mail visibility to trainer/admin role only.
- Shared training sheet views must not expose member e-mail addresses.

## Non-Functional Requirements

### NFR-1 Maintainability
- Keep implementation modular by domain (`config.ts`, `sheet.ts`, `mail.ts`, `calendar.ts`; optional `form.ts`, `webapp.ts`, `scheduler.ts`, `types.ts`).
- Avoid monolithic scripts and hidden cross-module coupling.

### NFR-2 Reliability
- Graceful degradation is required: manual sheet workflow must continue if automation fails.
- Use structured error handling around Google service calls.
- Prefer idempotent operations and lock critical write regions with `LockService`.

### NFR-3 Privacy and Data Protection
- Store e-mails only in hidden/protected backend sheet.
- Never expose full recipient lists in outbound e-mail (BCC or per-recipient sends).
- Avoid logging personal data unless strictly required for debugging.

### NFR-4 Environment Isolation
- Keep staging and production fully separated (Apps Script project and Google resources).
- Store all environment/resource IDs in `PropertiesService` with validation.

### NFR-5 Operational Compatibility
- Existing Google Sheet remains the trainer’s primary frontend.
- Runtime stays entirely on Google infrastructure.

## Constraints

### Technical Constraints
- Use only Google Workspace free-tier native tools: Sheets, Forms, Calendar, Gmail, Apps Script, Groups (optional).
- No third-party automation/services unless explicitly approved.
- Develop locally with VS Code + TypeScript + `clasp`.
- Use GitHub branching workflow:
  - `develop` for staging deployment,
  - `main` for production deployment.

### Data Constraints
- Persist contact data exclusively in backend tab (`Backend DB`).
- Ensure contact data remains inaccessible to regular sheet viewers.

### Configuration Constraints
- No hardcoded IDs/tokens in source code.
- Required IDs and environment settings must be read from `PropertiesService`.
