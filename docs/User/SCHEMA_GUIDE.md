# Schema-Anleitung – Google Sheets Definitionen

Dieses Dokument beschreibt die erforderlichen Tabellenlayouts für die vom RSVP-System verwendeten Google Sheets. Das System ist stark von bestimmten Kopfzeilen und Strukturen abhängig.

## 1. Private Systemtabelle (Benutzer & Konfiguration)
Dieses Spreadsheet ist über die Script-Property `PRIVATE_SHEETS_ID` verlinkt. Es dient als primäre Datenquelle und muss streng privat bleiben, um PII zu schützen.

Mindestens zwei Tabs (Arbeitsblätter) sind erforderlich:

### Tab: `Konfiguration`
Dieser Tab fungiert als Key-Value-Store für Systemkonfigurationen.

**Kopfzeile**:
- Optional, aber empfohlen.
- Die Laufzeit liest jede Zeile als `key | value`.
- Eine erste Zeile wie `Schlüssel | Wert` ist lesefreundlich, das System ist jedoch nicht auf den exakten Wortlaut angewiesen.

| Key (Spalte A)        | Value (Spalte B)                                  | Beschreibung / Beispiel                                                              |
|-----------------------|---------------------------------------------------|------------------------------------------------------------------------------------|
| `PUBLIC_SHEET_ID`     | `[Google Sheet ID]`                               | ID des öffentlichen Trainings-Sheets, das Trainer und Mitglieder zur Anwesenheit nutzen.               |
| `WEBAPP_URL`          | `https://script.google.com/.../exec`              | Deploy-URL dieses Apps-Script-Projekts; wird zur Erzeugung von RSVP-Links verwendet.       |

Hinweis: Weitere Schlüssel (z. B. Erinnerungszeiten oder Mapping-Definitionen) können hier durch den Konfigurationsadapter ergänzt werden.

### Tab: `Mitglieder` oder `Benutzer`
Diese Tabelle speichert Benutzeridentitäten, Rollen und Abonnements für Benachrichtigungen.

**Kopfzeile**:
- Muss in Zeile 1 vorhanden sein.
- Die Laufzeit behandelt die erste Zeile als Schema-Definition und sucht dort nach Spalten wie `FirstName`, `LastName`, `Email`, `Gender`, `Role` und `SubscribedTrainingIds`.
- Datenzeilen beginnen in Zeile 2.

| firstName | lastName     | gender | email                    | role       | subscribedTrainingIds        |
|-----------|--------------|--------|--------------------------|------------|------------------------------|
| `Max`     | `Mustermann` | `m`    | max.mustermann@email.com | `Mitglied` | `t-monday, t-wednesday`      |
| `Anna`    | `Admin`      | `w`    | anna@email.com           | `Trainer`  | `t-monday`                   |

- **Kompakter Member-Key**: Die Laufzeit leitet die interne `memberId` aus `firstName + lastName` ab (z. B. `Max Mustermann` → `max::mustermann`). Es sollte keine separate ID manuell vergeben werden.
- **`firstName` + `lastName`**: Zusammen bilden sie den Primärschlüssel und den öffentlichen Anzeigenamen in der Anwesenheitsmatrix. Der resultierende vollständige Name muss genau mit den Spaltenüberschriften im öffentlichen Trainings-Sheet übereinstimmen.
- **Namens-Sanitierung**: Sonderzeichen und Emojis in Vor- oder Nachnamen werden beim Einlesen entfernt (z. B. `Anna 🌞` → `Anna`).
- **`gender`**: Werte `m` oder `w`.
- **`email`**: Empfänger für Erinnerungen und Trainerberichte.
- **`role`**: Kanonische Werte sind `Mitglied` und `Trainer`. Alias-Werte wie `member` und `trainer` werden ebenfalls akzeptiert.
- **`subscribedTrainingIds`**: Komma-getrennte Liste von internen IDs für Trainings (Tage/Typen).
- **Kompatibilitäts-Fallback**: Eine ältere einzelne `Name`-Spalte wird noch erkannt, neue Setups sollten jedoch `FirstName` und `LastName` separat verwenden.

### Tab: `Systemprotokoll` (optional)
Dieser Tab wird bei Bedarf automatisch vom Runtime-Logger angelegt, sobald die erste Anforderung oder ein Trigger einen Eintrag schreibt.

| Zeitstempel | Woche | Level | Operation | Ereignis | Nachricht | Kontext |
|-------------|-------|-------|-----------|----------|-----------|---------|

- Der Tab ist ausschließlich für Maintainer vorgesehen.
- Er enthält bereinigte Laufzeitinformationen ohne direkte Namen oder E-Mail-Adressen.
- Der Inhalt wird bei Beginn einer neuen Kalenderwoche zurückgesetzt.

---

## 2. Öffentliches Trainings-Sheet (Trainer-/Mitglieder-Ansicht)
Dieses Spreadsheet wird von Trainern und Mitgliedern für die Übersicht genutzt und ist über `PUBLIC_SHEET_ID` konfiguriert. Es enthält die eigentliche Sessions-Matrix.

### Tab: `Trainings` (oder äquivalenter Ziel-Tab)
Die Anwesenheitsmatrix.

**Kopfzeile**:
- Muss in Zeile 1 vorhanden sein.
- Die Laufzeit interpretiert die erste Zeile als Schema und liest Systemspalten wie `SessionId`, `Datum` und `Metadata`.
- Anwesenheitsdaten beginnen in Zeile 2.

| SessionId | TerminId   | Datum      | Trainer    | Status    | Metadata | Max Mustermann | Anna Admin | (Weitere Namen...) |
|-----------|------------|------------|------------|-----------|----------|----------------|------------|--------------------|
| `s-1001`  | `t-monday` | 2026-03-16 | Anna Admin | Scheduled | `{...}`  | Accepted       | Declined   | ...                |

#### Minimale Systemspalten (links)
- **`SessionId`** oder **`TerminId`**: Eindeutige Kennung einer Session.
- **`Datum`**: Datum der Session.
- **`Metadata`**: Versteckte/protectete Spalte, in der das Script JSON-Payloads wie `{"max::mustermann": {"timestamp": "2026-03-14T10:00:00Z", "source": "email-rsvp"}}` ablegt. Diese Daten werden zur Konfliktauflösung zwischen manuellen Änderungen und RSVP-Einträgen verwendet.

#### Anwesenheitsspalten (rechts)
Nach der Metadata-Spalte folgt je Mitglied eine Spalte.
- Die **Spaltenüberschrift** MUSS exakt dem zusammengefügten `firstName + lastName` aus dem privaten Benutzersheet entsprechen.
- Erwartete Werte sind z. B. `Accepted` / `Declined` (oder lokalisierte Varianten wie `Zusage` / `Absage`).

Bei Ankunft einer RSVP (E-Mail oder Formular) sucht das `GoogleSheetTrainingDataRepository` die Kopfzeile für den Mitgliedsnamen und überschreibt die Zelle an der Kreuzung mit der entsprechenden `SessionId` mit dem RSVP-Status.

---

## 3. Wie der Maintainer das Schema prüft

Es gibt derzeit kein separates Kommando zur Schema-Validierung. Die Laufzeit prüft das Schema implizit beim Einlesen von Konfiguration und Tabellen.

### Was wird automatisch geprüft?
Die Laufzeit überprüft mehrere zentrale Bedingungen und schlägt bei Fehlern früh mit aussagekräftigen Meldungen fehl, z. B.:

- Fehlende Konfigurationsschlüssel wie `PUBLIC_SHEET_ID`
- Ungültiges JSON in `PUBLIC_TRAINING_SOURCES` oder `REMINDER_OFFSETS`
- Fehlende benötigte Spalten im Benutzersheet wie `Email` oder `Role`
- Fehlende `FirstName + LastName` oder die Legacy-Spalte `Name`
- Ungültige Trainings-Quellen-Definitionen (z. B. fehlende `attendance.startColumn`)

### Praktische Prüf-Workflows
Vorgehen nach dem Deployment:

1. Prüfen, dass `Konfiguration` mindestens die Schlüssel `PUBLIC_SHEET_ID` und `WEBAPP_URL` enthält.
2. Prüfen, dass `Benutzer` oder `Mitglieder` in Zeile 1 eine echte Kopfzeile hat und Daten in Zeile 2 beginnen.
3. Prüfen, dass das öffentliche `Trainings`-Sheet in Zeile 1 eine echte Kopfzeile hat und mindestens eine gültige Session-Zeile in Zeile 2 oder darunter existiert.
4. `runReminderDispatch` manuell in Apps Script ausführen.
5. Die `Executions`-Ansicht in Apps Script auf Laufzeitfehler prüfen.
6. Den privaten `Systemprotokoll`-Tab auf `INFO`/`WARN`/`ERROR`-Einträge prüfen.

### Typische Fehlermeldungen
Bei inkorrektem Schema treten typischerweise Meldungen wie diese auf:

- `Missing required configuration key: "PUBLIC_SHEET_ID"`
- `PUBLIC_TRAINING_SOURCES must be a JSON array.`
- `Public training source "..." must define attendance.startColumn.`
- `Missing required user sheet column: Email`
- `User sheet must define either FirstName + LastName columns or a Name column.`

Kurz: Zeilenbasierte Konfiguration im Tab `Konfiguration` ist flexibel, aber die Kopfzeilen in `Benutzer`/`Mitglieder` und `Trainings` sind zwingend.
