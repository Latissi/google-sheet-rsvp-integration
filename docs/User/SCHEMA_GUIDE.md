# Schema-Anleitung – Google Sheets Definitionen

Dieses Dokument beschreibt die einzige unterstützte Tabellenstruktur für das RSVP-System. Die Anwendung erwartet einen festen privaten Konfigurationsaufbau und ein öffentliches Trainingsblatt im Layout member-rows.

## 1. Private Systemtabelle
Dieses Spreadsheet ist über die Script-Property `PRIVATE_SHEETS_ID` verlinkt. Es enthält Konfiguration, Trainingsdefinitionen und private Mitgliederdaten und muss privat bleiben.

Erforderliche Tabs:
- `Konfiguration`
- `Trainingsquellen`
- `Trainingsdefinitionen`
- `Mitglieder`

### Tab `Konfiguration`
Der Tab wird als Key-Value-Tabelle gelesen.

| Schlüssel | Wert |
|-----------|------|

Erforderliche Schlüssel:

| Schlüssel | Beispielwert | Bedeutung |
|-----------|--------------|-----------|
| `OEFFENTLICHES_SHEET_ID` | `[Google Sheet ID]` | ID des öffentlichen Trainings-Sheets |
| `WEBAPP_ADRESSE` | `https://script.google.com/.../exec` | Deploy-URL der Web-App für RSVP-Links |
| `ERINNERUNGS_OFFSETS` | `[48,24]` | JSON-Array mit Stundenabständen für Erinnerungen |

### Tab `Trainingsquellen`

| SourceId | TabellenName | TabellenBereich | Layout | DatumsKopfZeile | MitgliederStartZeile | VornameSpalte | NachnameSpalte | StartSpalte |
|----------|--------------|-----------------|--------|-----------------|----------------------|---------------|----------------|-------------|
| `club-rsvp` | `RSVP Übersicht` | `A1:AZ200` | `member-rows` | `2` | `6` | `A` | `B` | `E` |

Regeln:
- `SourceId` ist eine stabile interne Kennung fuer diese Trainingsquelle.
- `SourceId` verknuepft die Zeile in `Trainingsquellen` mit den Zeilen in `Trainingsdefinitionen` und ist Teil der erzeugten `sessionId`.
- `SourceId` ist nicht der Tabname. Der eigentliche Name des Arbeitsblatts im oeffentlichen Trainings-Sheet steht in `TabellenName`.
- `TabellenName` meint also den sichtbaren Tabnamen des Arbeitsblatts innerhalb des ueber `OEFFENTLICHES_SHEET_ID` referenzierten Spreadsheets, zum Beispiel `RSVP Übersicht`.
- `Layout` muss `member-rows` sein.
- `DatumsKopfZeile` ist die absolute Zeilennummer im oeffentlichen Blatt, in der die eigentlichen Datums-Header stehen.
- `MitgliederStartZeile` ist die absolute Zeilennummer im oeffentlichen Blatt, in der die erste echte Mitgliederzeile beginnt.
- Das oeffentliche Spreadsheet wird immer ueber `OEFFENTLICHES_SHEET_ID` aus `Konfiguration` bestimmt. Eine separate `DateiId` pro Quelle gibt es nicht.

### Tab `Trainingsdefinitionen`

| SourceId | TrainingsId | Titel | Wochentag | Startzeit | Endzeit | Ort | Umgebung | Typ | Beschreibung |
|----------|-------------|-------|-----------|-----------|---------|-----|-----------|-----|--------------|
| `club-rsvp` | `wed-mixed` | `Mittwoch Training` | `Mittwoch` | `18:00` | `20:00` | `Sporthalle` | `Indoor` | `Mixed` |  |

Regeln:
- Dieser Tab wird nicht automatisch aus dem oeffentlichen Sheet erzeugt oder synchronisiert.
- Er muss manuell gepflegt werden, wenn neue Trainingsarten, Zeiten oder Metadaten hinzukommen oder sich aendern.
- Die Anwendung liest diese Definitionen nur ein, um Sessions, Erinnerungen und Trainerberichte fachlich anzureichern.
- `Wochentag` ist Pflicht.
- Eine Quelle darf mehrere Trainingsdefinitionen enthalten.
- Innerhalb einer Quelle muss jeder `Wochentag` eindeutig sein, damit jede Datumsspalte genau einer `TrainingsId` zugeordnet werden kann.

### Tab `Mitglieder`

| Vorname | Nachname | Geschlecht | EMail | Rolle | AbonnierteTrainingsIds |
|---------|----------|------------|-------|-------|------------------------|
| `Max` | `Mustermann` | `m` | `max.mustermann@email.com` | `Mitglied` | `wed-mixed` |
| `Anna` | `Admin` | `w` | `anna@email.com` | `Trainer` | `wed-mixed` |

Regeln:
- `Vorname` und `Nachname` bilden gemeinsam die interne `memberId`.
- `Rolle` darf nur `Mitglied` oder `Trainer` sein.
- Alle Personen, die RSVP oder Benachrichtigungen nutzen, müssen in diesem Tab vorhanden sein.

## 2. Öffentliches Trainings-Sheet
Unterstützt wird ausschließlich das Layout member-rows.

| Kategorie | Kategorie | Kategorie | 2026-03-11 | 2026-03-18 | 2026-03-25 |
|-----------|-----------|-----------|------------|------------|------------|
| Zusagen |  |  | 22 | 5 | 5 |
| Max | Mustermann | m | `x` | `-` |  |
| Anna | Admin | w |  | `x` | `x` |

Regeln:
- Eine Zeile pro Mitglied.
- Eine Datumsspalte pro Session.
- `x` für Zusage, `-` für Absage, leer für keine Antwort.
- Nicht-Mitgliederzeilen oberhalb von `MitgliederStartZeile` werden ignoriert.
- Die eigentliche Datumszeile wird ueber `DatumsKopfZeile` konfiguriert und muss nicht die erste Zeile des Bereichs sein.
- Die App gleicht jede Zeile ab `MitgliederStartZeile` gegen `Mitglieder` ab.
- Eine Quelle kann Datums-Spalten fuer mehrere Wochentage enthalten. Die Zuordnung zur passenden `TrainingsId` erfolgt ueber `Trainingsdefinitionen.Wochentag`.
- Trainingsabsagen werden als Notiz an der Kopfzelle der Datumsspalte gespeichert.

## 3. Registrierung über die Web-App
Pflichtparameter:

- `action=register`
- `email`
- `role`
- `gender`
- `firstName`
- `lastName`

## 4. Validierung
Typische Fehler sind fehlende Konfigurationsschlüssel, fehlende Spalten im Tab `Mitglieder` oder unvollständige Trainingsdefinitionen.

Kurz: Das System unterstützt genau ein privates Schema und genau ein öffentliches Layout.
