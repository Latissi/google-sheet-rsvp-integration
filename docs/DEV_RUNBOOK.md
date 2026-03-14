# Google Apps Script RSVP Integration - Dev Runbook

Since you have just pushed the code to your Dev environment using `npm run push:dev`, follow these steps to configure, run, and test the application in your Google Apps Script workspace.

## 0. Understand the Current Configuration Split
This project currently uses **two different configuration locations**:

1. **Apps Script Script Properties** for runtime/system values read by `src/config.ts`.
2. **The private Dev sheet** for application configuration and user data, read by `ConfigurationAdapter` from the tabs `Konfiguration` and `Benutzer`.

That means your original assumption was only partly wrong: many settings are indeed stored as rows in a sheet, but they are **not** the same values as the Script Properties.

## 1. Open the Project
Open the deployed Apps Script project in your browser.

This Apps Script project is expected to be **container-bound to the private Dev sheet**. The private sheet is the active spreadsheet used for the `Konfiguration` and `Benutzer` tabs. The public training sheet is accessed separately by ID.

## 2. Deploy as a Web App (Initial Setup)
To handle incoming RSVPs via HTTP GET requests (the `doGet` function), you must deploy the script as a Web App:
1. In the Apps Script editor, click **Deploy > New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. **Description**: e.g., "Dev Deployment 1".
4. **Execute as**: "Me" (your Google account).
5. **Who has access**: "Anyone".
6. Click **Deploy** and authorize the necessary permissions.
7. **Copy the Web App URL** from the final screen. You will need this for the configuration.

## 3. Set up Script Properties
The bootstrap runtime in `src/config.ts` requires several values in the Apps Script **Script Properties** store.

1. In the Apps Script editor, go to **Project Settings**.
2. Scroll down to **Script Properties** and click **Edit script properties**.
3. Add the following key-value pairs:
   * `ENV`: `dev`
   * `PRIVATE_SHEETS_ID`: The ID of your private Dev sheet.
   * `WEBAPPURL`: The deployed Web App URL.
   * `TRAINER_EMAIL`: Your email address. In `dev`, all outgoing emails are redirected here.
4. Click **Save script properties**.

Notes:
* `PRIVATE_SHEETS_ID` is currently validated by the runtime bootstrap even though it is not yet consumed elsewhere in the current implementation.
* The current codebase still validates `WEBAPPURL` in Script Properties via `src/config.ts`.
* Separately, reminder generation reads `WEBAPP_URL` from the `Konfiguration` sheet. At the moment, the project effectively expects both keys to be populated.

## 4. Set up the Private Dev Sheet
The private Dev sheet must contain at least these two tabs:

* `Konfiguration`
* `Benutzer` or `Mitglieder`

### `Konfiguration` tab
This tab is read as key/value rows. Typical structure:

```text
Schlüssel | Wert
PUBLIC_SHEET_ID | <ID of the public Dev training sheet>
PUBLIC_TRAINING_SOURCES | <JSON array, optional but preferred>
REMINDER_OFFSETS | <JSON array, optional>
WEBAPP_URL | <the Web App URL from Step 2>
```

Important:
* The key in the sheet is `WEBAPP_URL`.
* `PUBLIC_SHEET_ID`, `WEBAPP_URL`, and reminder/training-source configuration are read from the `Konfiguration` sheet, not from Script Properties.
* This is separate from the currently required Script Property `WEBAPPURL`.
* If you do not use `PUBLIC_TRAINING_SOURCES`, the legacy fallback keys must exist instead:
  * `TRAINING_SHEET_NAME`
  * `ATTENDANCE_START_COL`
  * `REMINDER_DAYS_BEFORE` or `REMINDER_OFFSETS`

### `Benutzer` or `Mitglieder` tab
This tab stores private user data. At minimum, the current implementation expects columns equivalent to:

```text
FirstName | LastName | Gender | Email | Role
```

Optional columns such as `SubscribedTrainings` and `SubscribedTrainingIds` are used for reminder/report delivery.
The runtime derives the internal member key automatically from `FirstName + LastName`, for example `Ada Lovelace` -> `ada::lovelace`.
Canonical role values are `Mitglied` and `Trainer`. The runtime also accepts `member` and `trainer`.

## 5. Set up Automation (Triggers)
The system currently exposes these triggerable functions:

* `runReminderDispatch(dispatchAt?)`
* `runTrainerParticipationReportDispatch(dispatchAt?, windowHours?)`
* `doGet(e)` for the deployed Web App

Create time-driven triggers for the delivery wrappers:
1. In the Apps Script editor, go to **Triggers**.
2. Click **Add Trigger**.
3. Configure:
   * **Choose which function to run:** `runReminderDispatch`
   * **Select event source:** `Time-driven`
   * **Select type of time based trigger:** `Day timer`
   * **Select time of day:** for example `8am to 9am`

Repeat the same process for `runTrainerParticipationReportDispatch` if you want trainer participation reports delivered automatically for sessions in the next 24 hours.

Do **not** create a direct time-driven trigger for `runTrainerParticipationReport` unless you intentionally want to invoke a single known `sessionId`.

## 6. How to Test the Dev Setup
Since `ENV` is set to `dev`, all emails will be redirected to your `TRAINER_EMAIL`.

### Test 1: Manual Triggering
1. In the Apps Script editor, select the `runReminderDispatch` function from the dropdown in the top toolbar.
2. Click **Run**.
3. Check your `TRAINER_EMAIL` inbox to verify that the reminder emails were generated and redirected correctly.
4. Check the execution log if nothing is sent.

To test trainer participation reports, either run `runTrainerParticipationReportDispatch` manually or call `runTrainerParticipationReport('<sessionId>')` for a specific upcoming session.

### Test 2: Simulating an RSVP (Web App Endpoint)
You can test the `doGet` webhook by pasting your deployed Web App URL into your browser with test parameters:
```text
[YOUR_WEB_APP_URL]?action=rsvp&memberId=ada::lovelace&sessionId=session-456&response=yes
```
* **Expected Result**: The browser should output "Danke, deine Teilnahme wurde gespeichert." and the backend logic should update your Dev Google Sheet accordingly.

### Test 3: Simulating a Registration POST
You can test the `doPost` registration endpoint by sending a POST request to the same Web App URL with at least `email`, `role`, `gender`, and either `name` or `firstName`/`lastName`. `action=register` is accepted but optional for registration requests.

## 7. Troubleshooting
* **Missing Script Property**: If execution fails in bootstrap, check `ENV`, `PRIVATE_SHEETS_ID`, `WEBAPPURL`, and `TRAINER_EMAIL` in **Script Properties**.
* **Missing Private Sheet Config**: If reminder or sheet access logic fails, check the `Konfiguration` tab for required keys such as `PUBLIC_SHEET_ID`, `WEBAPP_URL`, and the training/reminder configuration.
* **Key Name Split**: The current implementation distinguishes between `WEBAPPURL` in Script Properties and `WEBAPP_URL` in the `Konfiguration` sheet.
* **Trainer Report Trigger**: Use `runTrainerParticipationReportDispatch` for scheduled delivery and `runTrainerParticipationReport` only for one-off, explicit session IDs.
* **Interne Laufzeit-Logs**: Das Script schreibt interne Laufzeitereignisse in den privaten Tab `Systemprotokoll`. Der Tab wird bei Bedarf automatisch angelegt und pro Kalenderwoche überschrieben.
* **Permissions**: On the first manual run, Google will prompt you to "Review Permissions". Make sure to allow them.
* **Logs**: Check the **Executions** tab in the Apps Script editor to review stack traces if anything goes wrong.
