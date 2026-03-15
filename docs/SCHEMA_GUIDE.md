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
| `PUBLIC_TRAINING_SOURCES` | `[{...}]`                                    | JSON-Array zur Definition der öffentlichen Trainings-Tabs, Tabellenbereiche und Anwesenheitsspalten. |

Hinweis: Weitere Schlüssel (z. B. Erinnerungszeiten oder Mapping-Definitionen) können hier durch den Konfigurationsadapter ergänzt werden.

### Wie öffentliche Trainings-Tabs konfiguriert werden
Mehrere Tabs im öffentlichen Trainings-Sheet werden nicht separat über feste Einzel-Keys konfiguriert, sondern über den JSON-Key `PUBLIC_TRAINING_SOURCES` im Tab `Konfiguration`.

Beispiel:

```json
[
	{
		"sourceId": "club-rsvp",
		"sheetName": "RSVP Übersicht",
		"tableRange": "A1:AZ200",
		"attendance": {
			"layout": "member-rows",
			"firstNameColumn": "A",
			"lastNameColumn": "B",
			"startColumn": "C"
		},
		"trainings": [
			{
				"trainingId": "wed-mixed",
				"day": "Mittwoch",
				"title": "Mittwoch Training",
				"startTime": "18:00",
				"location": "Sporthalle",
				"environment": "Indoor",
				"audience": "Mixed"
			}
		]
	}
]
```

Bedeutung der Felder:
- `sheetName`: Name des Tabs im öffentlichen Spreadsheet.
- `tableRange`: Optionaler A1-Bereich der auszuwertenden Tabelle. Ohne Angabe wird der gesamte Tab gelesen.
- `attendance.layout`: Layout-Typ des öffentlichen Trainings-Tabs. Standard ist `session-rows`, für das aktuelle Vereins-Layout wird `member-rows` verwendet.
- `attendance.firstNameColumn`: Spalte mit dem Vornamen des Mitglieds bei `member-rows`.
- `attendance.lastNameColumn`: Spalte mit dem Nachnamen des Mitglieds bei `member-rows`.
- `attendance.startColumn`: Erste Trainingsdatum-Spalte. Ab hier interpretiert die Anwendung die Kopfzeile als Session-Daten.
- `attendance.metadataColumn`: Optionale Metadaten-Spalte für das ältere `session-rows`-Layout.
- `trainings`: Trainingsdefinitionen. Für `member-rows` muss genau ein Training konfiguriert werden; `startTime` sollte dort gesetzt sein.

### Legacy-Fallback
Falls `PUBLIC_TRAINING_SOURCES` nicht gesetzt ist, unterstützt die Anwendung nur eine vereinfachte Legacy-Konfiguration mit genau einem öffentlichen Tab:

| Key | Bedeutung |
|-----|-----------|
| `TRAINING_SHEET_NAME` | Name des öffentlichen Trainings-Tabs |
| `ATTENDANCE_START_COL` | Startspalte der Anwesenheitsmatrix |

Dieses Legacy-Modell ist nur für ein einzelnes Sheet ohne feinere Bereichsdefinition gedacht.

### Tab: `Mitglieder` oder `Benutzer`
Diese Tabelle speichert Benutzeridentitäten, Rollen und Abonnements für Benachrichtigungen.

**Rolle im aktuellen System**:
- Dieser Tab ist das private Benutzer-Repository der Anwendung.
- Die Registrierung über den Web-App-Endpunkt schreibt Benutzer per Upsert in diesen Tab.
- Der Tab wird für Rollen, E-Mail-Adressen, RSVP-Berechtigung, Reminder-Empfänger und Trainerberichte verwendet.
- Es gibt derzeit keine automatische Vollsynchronisation aus dem öffentlichen Trainings-Sheet in diesen Tab.
- Es gibt derzeit auch keine automatische Anlage neuer Anwesenheitsspalten im öffentlichen Trainings-Sheet auf Basis dieses Tabs.

**Was bedeutet das praktisch?**
- Alle Personen, die den RSVP-Service nutzen oder E-Mail-Benachrichtigungen erhalten sollen, müssen in diesem Tab vorhanden sein.
- Trainer, die Trainerberichte oder Absage-Berechtigungen erhalten sollen, müssen ebenfalls hier vorhanden sein.
- Personen, die nur manuell im öffentlichen Trainings-Sheet geführt werden und keine App-Funktionen nutzen, müssen nicht zwingend hier vorhanden sein.
- Wenn im öffentlichen Trainings-Sheet eine Namensspalte existiert, aber kein passender Benutzer in diesem Tab, ignoriert die Anwendung diese Spalte für RSVP-/Benachrichtigungslogik.

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
Dieses Spreadsheet wird von Trainern und Mitgliedern für die Übersicht genutzt und ist über `PUBLIC_SHEET_ID` konfiguriert.

### Aktuell unterstütztes Vereins-Layout: `member-rows`
Im aktuellen Layout steht **pro Mitglied genau eine Zeile** im Sheet.

**Aufbau**:
- Spalte `firstNameColumn`: Vorname
- Spalte `lastNameColumn`: Nachname
- Ab `attendance.startColumn`: je Spalte ein Trainingsdatum

Beispiel:

| FirstName | LastName    | 2026-03-11 | 2026-03-18 | 2026-03-25 |
|-----------|-------------|------------|------------|------------|
| Max       | Mustermann  | `x`        | `-`        |            |
| Anna      | Admin       |            | `x`        | `x`        |

Bedeutung:
- Jede **Datenzeile** repräsentiert ein Mitglied.
- Jede **Datumsspalte** repräsentiert eine Trainingseinheit.
- `x` bedeutet Zusage.
- `-` bedeutet Absage.
- Leere Zellen bedeuten: keine Rückmeldung.

So arbeitet die Anwendung damit:
- Die Anwendung liest Vor- und Nachname aus den konfigurierten Namensspalten.
- Daraus wird der Benutzer mit dem privaten Tab `Mitglieder`/`Benutzer` abgeglichen.
- Die Datumskopfzeile wird als Liste von Sessions interpretiert.
- Eine RSVP aktualisiert genau die Zelle an der Kreuzung aus Benutzerzeile und Datumsspalte.
- Für durch die App geschriebene RSVPs werden Metadaten als Zell-Notiz gespeichert.

Wichtig:
- Der Benutzer muss sowohl im öffentlichen Sheet als Zeile als auch im privaten Benutzertab vorhanden sein, damit die App ihn eindeutig zuordnen kann.
- Für `member-rows` muss in `PUBLIC_TRAINING_SOURCES.trainings[0]` mindestens ein `trainingId` und ein `startTime` konfiguriert sein, damit Sessions und Reminder korrekt erzeugt werden.
- Das automatische Markieren einer Trainingsabsage im öffentlichen Sheet ist derzeit nur für das Legacy-Layout `session-rows` implementiert.

### Weiterhin unterstützt: Legacy-Layout `session-rows`
Das ältere Layout mit **einer Session pro Zeile** und **einer Spalte pro Mitglied** wird weiterhin unterstützt, ist aber nicht mehr das primäre Dokumentationsbeispiel.

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
3. Prüfen, dass der öffentliche Trainings-Tab zur konfigurierten `PUBLIC_TRAINING_SOURCES`-Definition passt.
	Bei `member-rows`: Vorname/Nachname links, Datumszeile oben, Mitgliederdaten ab Zeile 2.
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
