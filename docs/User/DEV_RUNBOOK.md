# Google Apps Script RSVP Integration – Dev-Runbook

Dieses Runbook beschreibt die kanonische Dev-Einrichtung. Das System unterstützt genau einen Konfigurationspfad über das container-gebundene private Sheet und dessen Konfigurations-Tabs.

## 1. Projekt öffnen
Öffnen Sie das deployte Apps-Script-Projekt im Browser.

Das Projekt ist typischerweise container-gebunden an das private Dev-Sheet. Das private Sheet enthält die Tabs `Konfiguration`, `Trainingsquellen`, `Trainingsdefinitionen` und `Mitglieder`. Das öffentliche Trainings-Sheet wird separat per ID referenziert.
Zusätzlich kann die Anwendung dort die Laufzeit-Tabs `TeilnahmeMetadaten` und `VersandMetadaten` anlegen, sobald RSVP-Metadaten oder Absageversand-Metadaten geschrieben werden.

## 2. Als Web-App deployen
Um eingehende RSVPs per HTTP zu verarbeiten, deployen Sie das Script als Web-App.

1. Im Apps-Script-Editor `Deploy > New deployment` öffnen.
2. Typ `Web app` wählen.
3. `Execute as`: `Me`.
4. `Who has access`: in der Regel `Anyone`.
5. Deployen und die Web-App-URL kopieren.

## 3. Laufzeitmodell
Es werden keine Script Properties fuer den Bootstrap benoetigt.

Das Apps-Script-Projekt ist container-gebunden an das private Sheet. Laufzeitkonfiguration kommt aus dem privaten Sheet, insbesondere aus den Tabs `Konfiguration`, `Trainingsquellen`, `Trainingsdefinitionen` und `Mitglieder`.

## 4. Privates Dev-Sheet einrichten
Das private Dev-Sheet muss genau diese Tabs enthalten:

- `Konfiguration`
- `Trainingsquellen`
- `Trainingsdefinitionen`
- `Mitglieder`

Die Tabs `TeilnahmeMetadaten` und `VersandMetadaten` werden von der Anwendung selbst verwaltet. Sie muessen nicht manuell vorbereitet werden, duerfen aber auch nicht fuer Fachdaten zweckentfremdet werden.

### Tab `Konfiguration`

```text
Schlüssel | Wert
OEFFENTLICHES_SHEET_ID | <ID des öffentlichen Trainings-Sheets>
WEBAPP_ADRESSE | <die Web-App-URL aus dem Deployment>
ERINNERUNGS_OFFSETS | [48,24]
```

### Tab `Trainingsquellen`

```text
QuellenId | TabellenName | TabellenBereich | DatumsKopfZeile | InfoZeile | MitgliederStartZeile | VornameSpalte | NachnameSpalte | StartSpalte
club-rsvp | RSVP Übersicht | A1:AZ200 | 2 | 1 | 6 | A | B | E
```

`QuellenId` ist eine interne Kennung fuer die Quelle, nicht der Tabname. Sie verbindet `Trainingsquellen` mit `Trainingsdefinitionen` und taucht in erzeugten Session-IDs auf. `TabellenName` meint den sichtbaren Tabnamen des Arbeitsblatts innerhalb des ueber `OEFFENTLICHES_SHEET_ID` referenzierten oeffentlichen Spreadsheets. Das oeffentliche Spreadsheet selbst kommt immer aus `OEFFENTLICHES_SHEET_ID` im Tab `Konfiguration`.

`DatumsKopfZeile`, `InfoZeile` und `MitgliederStartZeile` sind absolute Zeilennummern im oeffentlichen Blatt. Damit kann die App auch Tabs mit Zusatzzeilen, Summenzeilen oder mehrzeiligen Headern verarbeiten, ohne das Public Sheet selbst zu aendern.
Wenn `InfoZeile` gesetzt ist, liest die App dort pro Datumsspalte zusaetzliche Session-Information. Enthält der Text `entfällt` oder `gesperrt`, behandelt die App die Session als abgesagt.

### Tab `Trainingsdefinitionen`

```text
QuellenId | TrainingsId | Titel | Wochentag | Startzeit | Endzeit | Ort | Umgebung
club-rsvp | wed-mixed | Mittwoch Training | Mittwoch | 18:00 | 20:00 | Sporthalle | Indoor
club-rsvp | mon-late | Montag Training | Montag | 20:15 | 21:45 | Sporthalle | Indoor
```

`Trainingsdefinitionen` wird nicht automatisch angepasst. Wenn Sie neue Trainingsarten, Startzeiten oder Orte einfuehren, muessen Sie diesen Tab manuell pflegen.
`Startzeit` und `Endzeit` werden intern als `HH:MM` verwendet. Wenn Google Sheets diese Zellen als Zeitwerte speichert, normalisiert die Anwendung sie beim Einlesen automatisch auf dieses Format.
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
Das System stellt folgende Zeit- oder Editor-Einstiegspunkte bereit:

- `runReminderDispatch(dispatchAt?)`
- `runTrainerParticipationReportDispatch(dispatchAt?, windowHours?)`

Die Web-App-Einstiegspunkte `doGet(e)` und `doPost(e)` werden nicht manuell im Editor ausgeführt. Sie werden über die deployte Web-App-URL mit Request-Parametern aufgerufen.

So legen Sie einen Zeit-Trigger an:

1. Im Apps-Script-Editor `Triggers` öffnen.
2. `Add Trigger` klicken.
3. `runReminderDispatch` auswählen.
4. `Time-driven` und ein passendes Zeitfenster wählen.

Für Trainerberichte entsprechend `runTrainerParticipationReportDispatch` verwenden.

Trainer erhalten in Reminder-Mails zusätzlich einen Link `Training absagen`. Der erste Klick öffnet nur eine Bestätigungsseite; erst nach der Bestätigung wird die Session abgesagt und eine Absage-Mail an alle Abonnenten verschickt.

## 6. Dev-Setup testen

### Test 1 – Reminder mit festem Zeitstempel ausführen
1. Im Editor `runReminderDispatch('2026-03-17T18:00:00.000Z')` mit einem Zeitstempel ausführen, der zu einer Session und zu `ERINNERUNGS_OFFSETS` passt.
2. Erwartung im Rückgabewert: ein Objekt mit `sessionsProcessed` und `sentCount`.
3. Die Posteingänge der im Tab `Mitglieder` eingetragenen Empfänger prüfen.
3. Bei Problemen die Executions-Ansicht prüfen.

Wenn kein Zeitstempel übergeben wird, verwendet die Funktion die aktuelle Uhrzeit. Dann kann ein korrektes System trotzdem `sentCount: 0` liefern.

### Test 2 – Trainerberichte mit festem Zeitfenster ausführen
1. Im Editor `runTrainerParticipationReportDispatch('2026-03-17T18:00:00.000Z', 24)` ausführen.
2. Erwartung im Rückgabewert: ein Objekt mit `sessionsProcessed` und `sentCount`.
3. Die Posteingänge der im Tab `Mitglieder` eingetragenen Trainer prüfen.

### Test 3 – RSVP über die Web-App
Browser-Aufruf:

```text
[IHRE_WEB_APP_URL]?action=rsvp&memberId=ada::lovelace&sessionId=session-456&response=yes
```

Erwartung: Die Anwendung bestätigt die Antwort und aktualisiert das öffentliche Sheet.

### Test 3a – Trainingsabsage für Trainer
Browser-Aufruf aus einem Trainer-Reminder oder manuell:

```text
[IHRE_WEB_APP_URL]?action=cancel-training&memberId=trainer::eins&sessionId=session-456
```

Erwartung: Zuerst erscheint nur eine Bestätigungsseite. Nach der Bestätigung schreibt die Anwendung einen Absage-Marker in die konfigurierte `InfoZeile`, verschickt Absage-Mails und das Training akzeptiert danach keine RSVP-Aktionen mehr.

### Test 4 – Registrierung über POST
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

### Test 5 – Benachrichtigungseinstellungen über POST
Die Pflege der Trainings-Abonnements läuft getrennt von der Registrierung:

```text
action=preferences
memberId=<member-id>
subscribedTrainingIds=wed-mixed,mon-late
```

`subscribedTrainingIds` erwartet eine komma- oder semikolon-getrennte Liste von `TrainingsId`-Werten. Ein leerer Wert entfernt alle Abonnements.

## 7. Fehlerbehebung
- Prüfen Sie bei Bootstrap-Fehlern, dass das Script container-gebunden an das richtige private Sheet ist.
- Prüfen Sie im Tab `Konfiguration`, dass `OEFFENTLICHES_SHEET_ID`, `WEBAPP_ADRESSE` und `ERINNERUNGS_OFFSETS` gesetzt sind.
- Prüfen Sie in `Trainingsquellen`, dass `DatumsKopfZeile`, `MitgliederStartZeile`, Vorname-, Nachname- und Startspalte gepflegt sind.
- Prüfen Sie in `Mitglieder`, dass Vorname, Nachname, EMail und Rolle vorhanden sind.
- Prüfen Sie bei Metadaten-Problemen die privaten Tabs `TeilnahmeMetadaten` und `VersandMetadaten` auf unvollständige oder doppelte Zeilen.
- Prüfen Sie die `Executions`-Ansicht und den privaten Tab `Systemprotokoll` auf Laufzeitfehler.

Dieses Runbook beschreibt absichtlich keinen Migrationspfad. Wenn ein bestehendes Sheet nicht in dieses Schema passt, muss das Sheet angepasst werden.
