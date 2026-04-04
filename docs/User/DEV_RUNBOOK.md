# Google Apps Script RSVP Integration – Dev-Runbook

Dieses Runbook beschreibt die kanonische Dev-Einrichtung. Das System unterstützt genau einen Konfigurationspfad über das container-gebundene private Sheet und dessen Konfigurations-Tabs.

## 1. Projekt öffnen
Öffnen Sie das deployte Apps-Script-Projekt im Browser.

Das Projekt ist typischerweise container-gebunden an das private Dev-Sheet. Das private Sheet enthält die Tabs `Konfiguration`, `Trainingsquellen`, `Trainingsdefinitionen` und `Mitglieder`. Das öffentliche Trainings-Sheet wird separat per ID referenziert.
Zusätzlich kann die Anwendung dort die Laufzeit-Tabs `TeilnahmeMetadaten`, `VersandMetadaten`, `ErinnerungsVersandMetadaten` und `LaufzeitMetadaten` anlegen, sobald RSVP-, Versand- oder Laufzeitmetadaten geschrieben werden.

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

Die Tabs `TeilnahmeMetadaten`, `VersandMetadaten`, `ErinnerungsVersandMetadaten` und `LaufzeitMetadaten` werden von der Anwendung selbst verwaltet. Sie muessen nicht manuell vorbereitet werden, duerfen aber auch nicht fuer Fachdaten zweckentfremdet werden.

### Tab `Konfiguration`

```text
Schlüssel | Wert
OEFFENTLICHES_SHEET_ID | <ID des öffentlichen Trainings-Sheets>
WEBAPP_ADRESSE | <die Web-App-URL aus dem Deployment>
ERINNERUNGS_OFFSETS | [48,24]
```

### Tab `Trainingsquellen`

```text
QuellenId | TabellenName | TabellenBereich | DatumsKopfZeile | InfoZeile | MitgliederStartZeile | VornameSpalte | NachnameSpalte | GeschlechtSpalte | StartSpalte
club-rsvp | RSVP Übersicht | A1:AZ200 | 2 | 1 | 6 | A | B | C | E
```

`QuellenId` ist eine interne Kennung fuer die Quelle, nicht der Tabname. Sie verbindet `Trainingsquellen` mit `Trainingsdefinitionen` und taucht in erzeugten Session-IDs auf. `TabellenName` meint den sichtbaren Tabnamen des Arbeitsblatts innerhalb des ueber `OEFFENTLICHES_SHEET_ID` referenzierten oeffentlichen Spreadsheets. Das oeffentliche Spreadsheet selbst kommt immer aus `OEFFENTLICHES_SHEET_ID` im Tab `Konfiguration`.

`DatumsKopfZeile`, `InfoZeile` und `MitgliederStartZeile` sind absolute Zeilennummern im oeffentlichen Blatt. Damit kann die App auch Tabs mit Zusatzzeilen, Summenzeilen oder mehrzeiligen Headern verarbeiten, ohne das Public Sheet selbst zu aendern.
`GeschlechtSpalte` ist optional. Wenn sie gesetzt ist, validiert die Registrierungs-Web-App einen Treffer im oeffentlichen Blatt nur dann als passend, wenn auch das Geschlecht übereinstimmt.
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
Vorname | Nachname | Geschlecht | EMail | Rolle | AbonnierteTrainingsIds | MitgliedId
Max | Mustermann | m | max.mustermann@email.com | Mitglied | wed-mixed | max::mustermann
Anna | Admin | w | anna@email.com | Trainer | wed-mixed | anna::admin
```

Regeln:
- `Vorname` und `Nachname` sind Pflicht.
- `Rolle` muss `Mitglied` oder `Trainer` sein.
- `EMail` ist für Benachrichtigungen erforderlich.
- `MitgliedId` wird bei der ersten Registrierung automatisch als normalisierte Form von `Vorname::Nachname` geschrieben und darf danach nicht mehr geändert werden.
- Zwei Mitglieder mit identischem `Vorname` und `Nachname` sind nicht unterstützt. Solche Dubletten müssen vor dem Betrieb im Tab `Mitglieder` bereinigt werden.
- `EMail` wird für Benachrichtigungen verwendet, ist aber nicht der Identitätsschlüssel.

## 5. Automatisierung einrichten
Das System stellt folgende Zeit- oder Editor-Einstiegspunkte bereit:

- `runReminderDispatch(dispatchAt?)`
- `runTrainerParticipationReportDispatch(dispatchAt?, windowHours?)`

Die Web-App-Einstiegspunkte `doGet(e)` und `doPost(e)` werden nicht manuell im Editor ausgeführt. Sie werden über die deployte Web-App-URL mit Request-Parametern aufgerufen.

So legen Sie einen Zeit-Trigger an:

1. Im Apps-Script-Editor `Triggers` öffnen.
2. `Add Trigger` klicken.
3. `runReminderDispatch` auswählen.
4. `Time-driven` und `Every 15 minutes` wählen.

Für Reminder gilt bewusst genau ein installierbarer 15-Minuten-Trigger. Die Anwendung wertet beim Lauf nicht nur den exakten aktuellen Zeitpunkt aus, sondern den Intervallbereich seit dem letzten erfolgreichen Reminder-Lauf. Dadurch werden Reminder nach kurzen Ausfällen oder verzögerten Triggerstarts beim nächsten erfolgreichen Lauf nachgeholt.

Die Tabs `ErinnerungsVersandMetadaten` und `LaufzeitMetadaten` bilden dabei den technischen Schutz:
- `ErinnerungsVersandMetadaten` verhindert doppelte Reminder pro Session und Offset.
- `LaufzeitMetadaten` speichert den letzten erfolgreichen Reminder-Lauf als Startpunkt fuer den naechsten Catch-up-Intervallvergleich.

Für Trainerberichte entsprechend `runTrainerParticipationReportDispatch` verwenden.

Trainer erhalten in Reminder-Mails zusätzlich einen Link `Training absagen`. Der erste Klick öffnet nur eine Bestätigungsseite; erst nach der Bestätigung wird die Session abgesagt und eine Absage-Mail an alle Abonnenten verschickt.

## 6. Dev-Setup testen

### Test 1 – Reminder mit festem Zeitstempel ausführen
1. Im Editor `runReminderDispatch('2026-03-17T18:15:00.000Z')` mit einem Zeitstempel ausführen, dessen 15-Minuten-Intervall einen Reminder-Zeitpunkt einschliesst.
2. Erwartung im Rückgabewert: ein Objekt mit `sessionsProcessed` und `sentCount`.
3. Die Posteingänge der im Tab `Mitglieder` eingetragenen Empfänger prüfen.
4. Bei Problemen die Executions-Ansicht sowie die Tabs `ErinnerungsVersandMetadaten` und `LaufzeitMetadaten` prüfen.

Wenn kein Zeitstempel übergeben wird, verwendet die Funktion die aktuelle Uhrzeit. Dann kann ein korrektes System trotzdem `sentCount: 0` liefern, wenn im seit dem letzten erfolgreichen Lauf betrachteten Intervall kein Reminder faellig war.

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

### Test 4 – Öffentliche Registrierung über die Web-App
Für die öffentliche Registrierung verwenden Sie die deployte Web-App-URL aus `WEBAPP_ADRESSE` mit dem Parameter `action=join`:

```text
[IHRE_WEB_APP_URL]?action=join
```

Beispiel: Wenn in `Konfiguration` bei `WEBAPP_ADRESSE` die URL `https://script.google.com/macros/s/abc123/exec` steht, dann lautet die Registrierungs-URL `https://script.google.com/macros/s/abc123/exec?action=join`.

Die Registrierungsseite selbst sendet ihre Daten anschliessend per POST an dieselbe Web-App-Basis-URL, also an `WEBAPP_ADRESSE`, mit `action=register` im Request.

Die Registrierungsseite legt immer ein öffentliches Mitgliedskonto an. Eine Trainer-Rolle wird nicht über die öffentliche Registrierung vergeben, sondern später durch die Script-Administration gepflegt.

Der dahinterliegende POST-Vertrag lautet:

```text
action=register
email=<mail>
gender=m|w
firstName=<vorname>
lastName=<nachname>
```

Alle Felder sind Pflicht.

Nach erfolgreicher Registrierung zeigt die Web-App direkt die Auswahl der Trainings-Abonnements an.
Zusätzlich zeigt sie pro konfiguriertem Trainings-Tab an, ob der Name dort bereits gefunden wurde. Zeilen mit passendem Vornamen, aber leerem Nachnamen werden bei diesem Abgleich ignoriert.

Wenn `Vorname` und `Nachname` bereits in `Mitglieder` existieren, behandelt die Web-App den ersten Schritt als Aktualisierung dieses bestehenden Mitglieds. Im zweiten Schritt werden die bereits gespeicherten Trainings-Abonnements vorausgewählt, und die Seite zeigt einen Hinweis mit der aktuell registrierten E-Mail-Adresse.

Nach dem Abschicken des zweiten Schritts speichert die Anwendung die gewählten Abonnements im privaten Tab `Mitglieder`. Für ausgewählte Trainingsquellen mit Status `Noch nicht im Tab` legt sie zusätzlich eine neue Mitgliederzeile im entsprechenden öffentlichen Trainings-Tab an. Bei `Bereits eingetragen` oder `Geschlecht stimmt nicht` erfolgt bewusst kein automatischer Eintrag. Zeilen mit passendem Vornamen, aber leerem Nachnamen gelten auch hier als `Noch nicht im Tab`.

### Test 5 – Benachrichtigungseinstellungen über POST
Die Pflege der Trainings-Abonnements läuft getrennt von der Registrierung:

```text
action=preferences
memberId=<member-id>
subscribedTrainingIds=wed-mixed,mon-late
```

`subscribedTrainingIds` erwartet eine komma- oder semikolon-getrennte Liste von `TrainingsId`-Werten. Ein leerer Wert entfernt alle Abonnements.

Dieselbe Seite wird sowohl im zweiten Registrierungsschritt als auch ueber den Reminder-Mail-Link `Benachrichtigungseinstellungen aktualisieren` zur Aenderung der Benachrichtigungen verwendet.

### Test 6 – Trainer manuell freischalten
Wenn eine Person Trainerrechte erhalten soll, pflegt die Script-Administration dies direkt im privaten Tab `Mitglieder`, indem `Rolle` von `Mitglied` auf `Trainer` gesetzt wird.

Erwartung: Erst danach erhält die Person Trainer-spezifische Fähigkeiten wie Trainingsabsage-Links und Beteiligungsreports.

## 7. Fehlerbehebung
- Prüfen Sie bei Bootstrap-Fehlern, dass das Script container-gebunden an das richtige private Sheet ist.
- Prüfen Sie im Tab `Konfiguration`, dass `OEFFENTLICHES_SHEET_ID`, `WEBAPP_ADRESSE` und `ERINNERUNGS_OFFSETS` gesetzt sind.
- Prüfen Sie in `Trainingsquellen`, dass `DatumsKopfZeile`, `MitgliederStartZeile`, Vorname-, Nachname-, optionale Geschlechts- und Startspalte gepflegt sind.
- Prüfen Sie in `Mitglieder`, dass Vorname, Nachname, EMail, Rolle und MitgliedId vorhanden sind und dass keine doppelten Namen existieren.
- Prüfen Sie bei Metadaten-Problemen die privaten Tabs `TeilnahmeMetadaten`, `VersandMetadaten`, `ErinnerungsVersandMetadaten` und `LaufzeitMetadaten` auf unvollständige oder doppelte Zeilen.
- Prüfen Sie die `Executions`-Ansicht und den privaten Tab `Systemprotokoll` auf Laufzeitfehler.

Dieses Runbook beschreibt absichtlich keinen Migrationspfad. Wenn ein bestehendes Sheet nicht in dieses Schema passt, muss das Sheet angepasst werden.

## 8. Fehlerbehandlungsvertrag

Dieser Abschnitt legt fest, wie Fehler pro Schicht behandelt werden.

### Domain-Schicht (`src/domain/`)
- Wirf `Error` für ungültige Eingaben (z. B. fehlendes Pflichtfeld, unbekannter Status).
- Kein Abfangen von Fehlern – ungeprüfte Zustände zeigen Programmierfehler an.

### Application-Schicht (`src/application/`)
- Services geben immer ein Ergebnisobjekt zurück: `{ ok: true, ... }` bei Erfolg oder `{ ok: false, message: string }` bei erwarteten Fehlern.
- Wirf nur dann einen Fehler, wenn ein nicht wiederherstellbarer Zustand vorliegt (z. B. Integritätsverletzung).
- Fange keine Fehler aus Ports ab – Infrastructure-Fehler propagieren nach oben.

### Infrastructure-Schicht (`src/infrastructure/`)
- Adapter werfen `Error` bei ungültigen Sheet-Daten (z. B. unvollständige Zeilen, doppelte Schlüssel, ungültige Enum-Werte).
- Sheet-Spaltenschlüssel dürfen in zusammengesetzten Schlüsseln nie den jeweiligen Separator enthalten: `__` für Session-IDs, `::` für Member-IDs.
- Keine stille Fehlerbehandlung mit Fallback-Werten – Datenprobleme sollen frühzeitig sichtbar werden.

### Runtime-Schicht (`src/runtime/`)
- `doGet` und `doPost` fangen alle Fehler ab und geben immer eine HTTP-Antwort zurück.
- Unerwartete Fehler werden geloggt und als generische öffentliche Fehlermeldung zurückgegeben (kein Stack-Trace an den Client).
- Timer-basierte Dispatcher (`runReminderDispatch`, `runTrainerParticipationReportDispatch`) lassen Fehler propagieren, damit die Apps-Script-Executions-Ansicht den Fehler anzeigt.
