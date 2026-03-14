# Google Apps Script RSVP Integration – Dev-Runbook

Wenn Sie den Code gerade mit `npm run push:dev` in Ihre Dev-Umgebung geschoben haben, folgen Sie diesen Schritten, um die Anwendung in Apps Script zu konfigurieren, auszuführen und zu testen.

## 0. Verständnis der aktuellen Konfigurationsaufteilung
Das Projekt verwendet aktuell **zwei Orte** für Konfigurationen:

1. **Apps Script Script Properties** für Laufzeit-/Systemwerte (gelesen von `src/config.ts`).
2. **Das private Dev-Sheet** für Anwendungs-Konfiguration und Benutzerdaten (gelesen vom `ConfigurationAdapter` in den Tabs `Konfiguration` und `Benutzer`).

Das bedeutet: Viele Einstellungen liegen zwar als Zeilen in einem Sheet vor, sind aber nicht identisch mit den Script Properties.

## 1. Projekt öffnen
Öffnen Sie das deployte Apps Script Projekt im Browser.

Das Projekt ist typischerweise container-gebunden an das private Dev-Sheet. Das private Sheet enthält die Tabs `Konfiguration` und `Benutzer`. Das öffentliche Trainings-Sheet wird separat per ID referenziert.

## 2. Als Web-App deployen (Initiale Einrichtung)
Um eingehende RSVPs per HTTP GET (`doGet`) zu verarbeiten, deployen Sie das Script als Web-App:

1. Im Apps Script Editor: **Deploy > New deployment**.
2. Wählen Sie beim Typ die **Web app**-Option.
3. **Description**: z. B. "Dev Deployment 1".
4. **Execute as**: "Me" (Ihr Google-Konto).
5. **Who has access**: in der Regel "Anyone" für öffentliche RSVP-Links.
6. Klicken Sie auf **Deploy** und erteilen Sie die notwendigen Berechtigungen.
7. Kopieren Sie die Web-App-URL aus dem Abschlussdialog – diese wird für die Konfiguration benötigt.

## 3. Script Properties setzen
Der Bootstrap in `src/config.ts` erwartet mehrere Keys in den Apps Script Script Properties.

1. Im Apps Script Editor: **Project Settings** öffnen.
2. Unter **Script Properties** auf **Edit script properties** klicken.
3. Setzen Sie mindestens folgende Schlüssel:
   * `ENV`: `dev`
   * `PRIVATE_SHEETS_ID`: ID Ihres privaten Dev-Sheets
   * `WEBAPPURL`: Die deployte Web-App-URL
   * `TRAINER_EMAIL`: Ihre E-Mail-Adresse (in `dev` werden alle ausgehenden Mails hierhin umgeleitet)
4. Auf **Save script properties** klicken.

Hinweise:
- `PRIVATE_SHEETS_ID` wird aktuell vom Bootstrap validiert, auch wenn andere Teile des Codes es noch nicht aktiv nutzen.
- Die Codebasis validiert `WEBAPPURL` als Script Property; zusätzlich liest die Reminder-Generierung `WEBAPP_URL` aus dem `Konfiguration`-Tab. Beide Keys sollten vorhanden sein.

## 4. Privates Dev-Sheet einrichten
Das private Dev-Sheet sollte mindestens folgende Tabs enthalten:

- `Konfiguration`
- `Benutzer` oder `Mitglieder`

### Tab `Konfiguration`
Dieser Tab wird zeilenweise als Schlüssel/Wert gelesen. Beispielstruktur:

```text
Schlüssel | Wert
PUBLIC_SHEET_ID | <ID des öffentlichen Trainings-Sheets>
PUBLIC_TRAINING_SOURCES | <JSON-Array, optional aber empfohlen>
REMINDER_OFFSETS | <JSON-Array, optional>
WEBAPP_URL | <die Web-App-URL aus Schritt 2>
```

Wichtig:
- Der Key im Sheet heißt `WEBAPP_URL`.
- `PUBLIC_SHEET_ID`, `WEBAPP_URL` und Trainings-/Reminder-Konfiguration werden aus dem `Konfiguration`-Tab gelesen, nicht aus den Script Properties.
- Falls `PUBLIC_TRAINING_SOURCES` nicht verwendet wird, müssen die Legacy-Keys vorhanden sein:
  * `TRAINING_SHEET_NAME`
  * `ATTENDANCE_START_COL`
  * `REMINDER_DAYS_BEFORE` oder `REMINDER_OFFSETS`

### Tab `Benutzer` / `Mitglieder`
Dieser Tab enthält die privaten Benutzerdaten. Mindestens erwartet die Laufzeit Spalten wie:

```text
FirstName | LastName | Gender | Email | Role
```

Optionale Spalten wie `SubscribedTrainings` / `SubscribedTrainingIds` werden für Reminder und Reports genutzt. Die interne `memberId` wird automatisch aus `FirstName + LastName` gebildet (z. B. `Ada Lovelace` → `ada::lovelace`).
Gängige Rollen: `Mitglied`, `Trainer` (auch `member`/`trainer` werden als Aliase akzeptiert).

## 5. Automatisierung (Triggers) einrichten
Das System stellt folgende triggerbaren Funktionen bereit:

- `runReminderDispatch(dispatchAt?)`
- `runTrainerParticipationReportDispatch(dispatchAt?, windowHours?)`
- `doGet(e)` (Web-App Endpoint)

So legen Sie einen zeitgesteuerten Trigger an:

1. Im Apps Script Editor: **Triggers** öffnen.
2. **Add Trigger** klicken.
3. Konfigurieren:
   * **Function**: `runReminderDispatch`
   * **Event source**: `Time-driven`
   * **Type**: `Day timer`
   * **Time of day**: z. B. `8am to 9am`

Wiederholen Sie das Verfahren für `runTrainerParticipationReportDispatch`, wenn automatische Reports gewünscht sind.
Erstellen Sie **keinen** direkten Zeit-Trigger für `runTrainerParticipationReport`, außer Sie möchten eine einzige, bekannte `sessionId` auslösen.

## 6. Dev-Setup testen
In `dev` werden alle E-Mails an `TRAINER_EMAIL` umgeleitet.

### Test 1 – Manueller Trigger
1. Wählen Sie im Editor die Funktion `runReminderDispatch` aus und klicken Sie auf **Run**.
2. Prüfen Sie den Posteingang von `TRAINER_EMAIL` auf die generierten Erinnerungen.
3. Falls nichts ankommt, werfen Sie einen Blick in die Execution-Logs.

Für Reports: `runTrainerParticipationReportDispatch` manuell ausführen oder `runTrainerParticipationReport('<sessionId>')` für eine spezifische Session aufrufen.

### Test 2 – RSVP via Web-App (doGet)
Öffnen Sie im Browser die Web-App-URL mit Testparametern:

```text
[IHRE_WEB_APP_URL]?action=rsvp&memberId=ada::lovelace&sessionId=session-456&response=yes
```

Erwartetes Ergebnis: Die Seite zeigt eine Dankesmeldung (z. B. „Danke, deine Teilnahme wurde gespeichert.“) und das Dev-Sheet wird entsprechend aktualisiert.

### Test 3 – Registrierung via POST (doPost)
Senden Sie eine POST-Anfrage an die Web-App-URL mit mindestens `email`, `role`, `gender` und entweder `name` oder `firstName`/`lastName`. `action=register` wird akzeptiert, ist aber optional.

## 7. Fehlerbehebung
- **Fehlende Script Property**: Bei Bootstrap-Fehlern prüfen Sie `ENV`, `PRIVATE_SHEETS_ID`, `WEBAPPURL` und `TRAINER_EMAIL` in den Script Properties.
- **Fehlende Konfiguration im privaten Sheet**: Prüfen Sie den `Konfiguration`-Tab auf `PUBLIC_SHEET_ID`, `WEBAPP_URL` und Trainings-/Reminder-Keys.
- **Key-Name-Verdopplung**: Die Implementierung unterscheidet zwischen `WEBAPPURL` (Script Properties) und `WEBAPP_URL` (Konfiguration-Tab).
- **Trainer-Report Trigger**: Nutzen Sie `runTrainerParticipationReportDispatch` für geplante Auslieferung; `runTrainerParticipationReport` nur für Einzeleinsatz.
- **Interne Laufzeit-Logs**: Das Script schreibt runtime-Ereignisse in den privaten Tab `Systemprotokoll`. Der Tab wird automatisch angelegt und wöchentlich überschrieben.
- **Berechtigungen**: Beim ersten manuellen Lauf fordert Google zur Freigabe von Berechtigungen auf – diese müssen bestätigt werden.
- **Logs**: Prüfen Sie die **Executions**-Ansicht im Apps Script Editor bei Stacktraces oder Fehlern.
