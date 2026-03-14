# Schema Guide – Google Sheets Definitions

This guide details the required layouts for the Google Sheets used by the RSVP System. The system heavily relies on specific headers and structures to work correctly.

## 1. Private System Sheet (User & Config Data)
This is the sheet linked by the `PRIVATE_SHEETS_ID` script property. It serves as your database and must remain strictly private to protect PII.

It must contain at minimum two tabs (worksheets):

### Tab: `Konfiguration`
This tab works as a key-value store for system configurations.

| Key (Column A)        | Value (Column B)                                  | Description / Example                                                              |
|-----------------------|---------------------------------------------------|------------------------------------------------------------------------------------|
| `PUBLIC_SHEET_ID`     | `[Google Sheet ID]`                               | ID of the public sheet where trainers and members manage attendance.               |
| `WEBAPP_URL`          | `https://script.google.com/.../exec`              | The deployment URL of this Apps Script project. Used to generate RSVP links.       |

*Note: Further keys like specific reminder times or training mappings might be added here by the configuration adapter.*

### Tab: `Mitglieder` or `Benutzer` (Users)
This table stores user identities, roles, and subscriptions for notifications.

| firstName | lastName     | gender | email                    | role       | subscribedTrainingIds        |
|-----------|--------------|--------|--------------------------|------------|------------------------------|
| `Max`     | `Mustermann` | `m`    | max.mustermann@email.com | `Mitglied` | `t-monday, t-wednesday`      |
| `Anna`    | `Admin`      | `w`    | anna@email.com           | `Trainer`  | `t-monday`                   |

* **Composite member key**: The runtime derives the internal `memberId` from `firstName + lastName`, for example `Max Mustermann` becomes `max::mustermann`. No surrogate ID should be assigned manually.
* **`firstName` + `lastName`**: Together they form the primary key and the public attendance display name. The resulting full name **must identically match** the column headers used in the Public Training Sheet.
* **Name sanitization**: Symbols and emoji in first or last names are stripped when the app reads and stores internal user data. `Anna 🌞` is treated internally as `Anna`.
* **`gender`**: Stored as `m` or `w`.
* **`email`**: Where reminders and trainer reports are sent.
* **`role`**: Canonical values are `Mitglied` and `Trainer`. The runtime also accepts `member` and `trainer` as aliases.
* **`subscribedTrainingIds`**: Comma-separated list correlating to internal IDs for different training days/types.
* **Compatibility fallback**: A legacy single `Name` column is still read for migration scenarios, but new setups should use separate `FirstName` and `LastName` columns.
* **Legacy fallback**: `SubscribedTrainings` may still be present and is used when `subscribedTrainingIds` is empty.

### Tab: `Systemprotokoll` (optional)
This tab is created automatically by the deployed runtime when the first request or trigger writes an internal log entry.

| Zeitstempel | Woche | Level | Operation | Ereignis | Nachricht | Kontext |
|-------------|-------|-------|-----------|----------|-----------|---------|

* The tab is intended for maintainers only.
* It contains sanitized runtime data without names or email addresses.
* The content is reset when a new calendar week begins.

---

## 2. Public Training Sheet (Trainer/Member View)
This is the sheet everyone uses for the overview, linked via `PUBLIC_SHEET_ID` in the configuration. It tracks the actual sessions.

### Tab: `Trainings` (or equivalent target)
The actual attendance matrix.

| SessionId | TerminId   | Datum      | Trainer    | Status    | Metadata | Max Mustermann | Anna Admin | (Weitere Namen...) |
|-----------|------------|------------|------------|-----------|----------|----------------|------------|--------------------|
| `s-1001`  | `t-monday` | 2026-03-16 | Anna Admin | Scheduled | `{...}`  | Accepted       | Declined   | ...                |
| `s-1002`  | `t-wednes` | 2026-03-18 | Max M.     | Canceled  |          |                | Accepted   | ...                |

#### Minimum System Columns (To the Left)
* **`SessionId`** or **`TerminId`**: Unique identifier for the exact session (e.g., "Monday, March 16th").
* **`Datum`**: The date of the session.
* **`Metadata`**: Hidden or protected column where the Apps Script drops JSON payloads like `{"max::mustermann": {"timestamp": "2026-03-14T10:00:00Z", "source": "email-rsvp"}}`. This is used to resolve conflicts between manual edits and email RSVPs.

#### Attendance Columns (To the Right)
After the metadata, there should be one column per member. 
* The **Header** of the column **must perfectly match** the concatenated `firstName + lastName` value from the private user sheet.
* The system expects values like: `Accepted` / `Declined` (or their configured localizations like `Zusage` / `Absage`).

When an RSVP via Email or Form arrives, the `GoogleSheetTrainingDataRepository` searches the headers for the member's name and overwrites the cell intersecting with the given `SessionId` with the RSVP status.
