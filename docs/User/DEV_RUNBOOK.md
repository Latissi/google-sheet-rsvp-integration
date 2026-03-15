# Google Apps Script RSVP Integration – Dev-Runbook

Dieses Runbook beschreibt die kanonische Dev-Einrichtung. Das System unterstützt genau einen Konfigurationspfad über Script Properties plus privates Konfigurations-Sheet.

## 1. Projekt öffnen
Öffnen Sie das deployte Apps-Script-Projekt im Browser.

Das Projekt ist typischerweise container-gebunden an das private Dev-Sheet. Das private Sheet enthält die Tabs `Konfiguration`, `Trainingsquellen`, `Trainingsdefinitionen` und `Mitglieder`. Das öffentliche Trainings-Sheet wird separat per ID referenziert.

## 2. Als Web-App deployen
Um eingehende RSVPs per HTTP zu verarbeiten, deployen Sie das Script als Web-App.

1. Im Apps-Script-Editor `Deploy > New deployment` öffnen.
2. Typ `Web app` wählen.
3. `Execute as`: `Me`.
4. `Who has access`: in der Regel `Anyone`.
5. Deployen und die Web-App-URL kopieren.

## 3. Script Properties setzen
Der Bootstrap in `src/config.ts` erwartet folgende Script Properties:

- `ENV=dev`
- `PRIVATE_SHEETS_ID=<ID des privaten Sheets>`
- `WEBAPPURL=<deployte Web-App-URL>`
- `TRAINER_EMAIL=<Ihre E-Mail-Adresse>`

In `dev` werden alle ausgehenden Mails an `TRAINER_EMAIL` umgeleitet.

## 4. Privates Dev-Sheet einrichten
Das private Dev-Sheet muss genau diese Tabs enthalten:

- `Konfiguration`
- `Trainingsquellen`
- `Trainingsdefinitionen`
- `Mitglieder`

### Tab `Konfiguration`

```text
Schlüssel | Wert
OEFFENTLICHES_SHEET_ID | <ID des öffentlichen Trainings-Sheets>
WEBAPP_ADRESSE | <die Web-App-URL aus dem Deployment>
ERINNERUNGS_OFFSETS | [48,24]
```

### Tab `Trainingsquellen`

```text
SourceId | TabellenName | TabellenBereich | Layout | DatumsKopfZeile | MitgliederStartZeile | VornameSpalte | NachnameSpalte | StartSpalte
club-rsvp | RSVP Übersicht | A1:AZ200 | member-rows | 2 | 6 | A | B | E
```

`SourceId` ist eine interne Kennung fuer die Quelle, nicht der Tabname. Sie verbindet `Trainingsquellen` mit `Trainingsdefinitionen` und taucht in erzeugten Session-IDs auf. `TabellenName` meint den sichtbaren Tabnamen des Arbeitsblatts innerhalb des ueber `OEFFENTLICHES_SHEET_ID` referenzierten oeffentlichen Spreadsheets. Das oeffentliche Spreadsheet selbst kommt immer aus `OEFFENTLICHES_SHEET_ID` im Tab `Konfiguration`.

`DatumsKopfZeile` und `MitgliederStartZeile` sind absolute Zeilennummern im oeffentlichen Blatt. Damit kann die App auch Tabs mit Zusatzzeilen, Summenzeilen oder mehrzeiligen Headern verarbeiten, ohne das Public Sheet selbst zu aendern.

### Tab `Trainingsdefinitionen`

```text
SourceId | TrainingsId | Titel | Wochentag | Startzeit | Endzeit | Ort | Umgebung | Typ | Beschreibung
club-rsvp | wed-mixed | Mittwoch Training | Mittwoch | 18:00 | 20:00 | Sporthalle | Indoor | Mixed |
club-rsvp | mon-late | Montag Training | Montag | 20:15 | 21:45 | Sporthalle | Indoor | Mixed |
```

`Trainingsdefinitionen` wird nicht automatisch angepasst. Wenn Sie neue Trainingsarten, Startzeiten oder andere Metadaten einfuehren, muessen Sie diesen Tab manuell pflegen.
Innerhalb einer Quelle muss jeder `Wochentag` eindeutig sein.

### Tab `Mitglieder`

```text
Vorname | Nachname | Geschlecht | EMail | Rolle | AbonnierteTrainingsIds
Max | Mustermann | m | max.mustermann@email.com | Mitglied | wed-mixed
Anna | Admin | w | anna@email.com | Trainer | wed-mixed
```

Regeln:
- `Vorname` und `Nachname` sind Pflicht.
- `Rolle` muss `Mitglied` oder `Trainer` sein.
- `EMail` ist für Benachrichtigungen erforderlich.

## 5. Automatisierung einrichten
Das System stellt folgende triggerbaren Funktionen bereit:

- `runReminderDispatch(dispatchAt?)`
- `runTrainerParticipationReportDispatch(dispatchAt?, windowHours?)`
- `doGet(e)`
- `doPost(e)`

So legen Sie einen Zeit-Trigger an:

1. Im Apps-Script-Editor `Triggers` öffnen.
2. `Add Trigger` klicken.
3. `runReminderDispatch` auswählen.
4. `Time-driven` und ein passendes Zeitfenster wählen.

Für Trainerberichte entsprechend `runTrainerParticipationReportDispatch` verwenden.

## 6. Dev-Setup testen

### Test 1 – Reminder manuell ausführen
1. Im Editor `runReminderDispatch` ausführen.
2. Den Posteingang von `TRAINER_EMAIL` prüfen.
3. Bei Problemen die Executions-Ansicht prüfen.

### Test 2 – RSVP über die Web-App
Browser-Aufruf:

```text
[IHRE_WEB_APP_URL]?action=rsvp&memberId=ada::lovelace&sessionId=session-456&response=yes
```

Erwartung: Die Anwendung bestätigt die Antwort und aktualisiert das öffentliche Sheet.

### Test 3 – Registrierung über POST
Die Registrierung akzeptiert nur diesen Vertrag:

```text
action=register
email=<mail>
role=Mitglied|Trainer
gender=m|w
firstName=<vorname>
lastName=<nachname>
```

Alle Felder sind Pflicht.

### Test 4 – Benachrichtigungseinstellungen über POST
Die Pflege der Trainings-Abonnements läuft getrennt von der Registrierung:

```text
action=preferences
memberId=<member-id>
subscribedTrainingIds=wed-mixed,mon-late
```

`subscribedTrainingIds` erwartet eine komma- oder semikolon-getrennte Liste von `TrainingsId`-Werten. Ein leerer Wert entfernt alle Abonnements.

## 7. Fehlerbehebung
- Prüfen Sie bei Bootstrap-Fehlern `ENV`, `PRIVATE_SHEETS_ID`, `WEBAPPURL` und `TRAINER_EMAIL` in den Script Properties.
- Prüfen Sie im Tab `Konfiguration`, dass `OEFFENTLICHES_SHEET_ID`, `WEBAPP_ADRESSE` und `ERINNERUNGS_OFFSETS` gesetzt sind.
- Prüfen Sie in `Trainingsquellen`, dass `Layout` auf `member-rows` steht und `DatumsKopfZeile`, `MitgliederStartZeile`, Vorname-, Nachname- und Startspalte gepflegt sind.
- Prüfen Sie in `Mitglieder`, dass Vorname, Nachname, EMail und Rolle vorhanden sind.
- Prüfen Sie die `Executions`-Ansicht und den privaten Tab `Systemprotokoll` auf Laufzeitfehler.

Dieses Runbook beschreibt absichtlich keinen Migrationspfad. Wenn ein bestehendes Sheet nicht in dieses Schema passt, muss das Sheet angepasst werden.
