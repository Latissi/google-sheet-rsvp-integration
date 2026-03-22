# Schema-Anleitung – Google Sheets Definitionen

Dieses Dokument beschreibt die einzige unterstützte Tabellenstruktur für das RSVP-System. Die Anwendung erwartet einen festen privaten Konfigurationsaufbau und ein öffentliches Trainingsblatt mit Mitgliederzeilen und Datumsspalten.

## 1. Private Systemtabelle
Dieses Spreadsheet ist das container-gebundene private Apps-Script-Sheet. Es enthält Konfiguration, Trainingsdefinitionen und private Mitgliederdaten und muss privat bleiben.

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

| QuellenId | TabellenName | TabellenBereich | DatumsKopfZeile | InfoZeile | MitgliederStartZeile | VornameSpalte | NachnameSpalte | StartSpalte |
|-----------|--------------|-----------------|-----------------|-----------|----------------------|---------------|----------------|-------------|
| `club-rsvp` | `RSVP Übersicht` | `A1:AZ200` | `2` | `1` | `6` | `A` | `B` | `E` |

Regeln:
- `QuellenId` ist eine stabile interne Kennung fuer diese Trainingsquelle.
- `QuellenId` verknuepft die Zeile in `Trainingsquellen` mit den Zeilen in `Trainingsdefinitionen` und ist Teil der erzeugten `sessionId`.
- `QuellenId` ist nicht der Tabname. Der eigentliche Name des Arbeitsblatts im oeffentlichen Trainings-Sheet steht in `TabellenName`.
- `TabellenName` meint also den sichtbaren Tabnamen des Arbeitsblatts innerhalb des ueber `OEFFENTLICHES_SHEET_ID` referenzierten Spreadsheets, zum Beispiel `RSVP Übersicht`.
- `DatumsKopfZeile` ist die absolute Zeilennummer im oeffentlichen Blatt, in der die eigentlichen Datums-Header stehen.
- `InfoZeile` ist optional. Wenn gesetzt, wird in dieser absoluten Zeile pro Datumsspalte zusaetzliche Session-Information gelesen.
- `MitgliederStartZeile` ist die absolute Zeilennummer im oeffentlichen Blatt, in der die erste echte Mitgliederzeile beginnt.
- `InfoZeile` muss vor `MitgliederStartZeile` liegen.
- Das oeffentliche Spreadsheet wird immer ueber `OEFFENTLICHES_SHEET_ID` aus `Konfiguration` bestimmt. Eine separate `DateiId` pro Quelle gibt es nicht.

### Tab `Trainingsdefinitionen`

| QuellenId | TrainingsId | Titel | Wochentag | Startzeit | Endzeit | Ort | Umgebung |
|-----------|-------------|-------|-----------|-----------|---------|-----|-----------|
| `club-rsvp` | `wed-mixed` | `Mittwoch Training` | `Mittwoch` | `18:00` | `20:00` | `Sporthalle` | `Indoor` |

Regeln:
- Dieser Tab wird nicht automatisch aus dem oeffentlichen Sheet erzeugt oder synchronisiert.
- Er muss manuell gepflegt werden, wenn neue Trainingsarten, Zeiten oder Orte hinzukommen oder sich aendern.
- Die Anwendung liest diese Definitionen nur ein, um Sessions, Erinnerungen und Trainerberichte fachlich anzureichern.
- `Wochentag` ist Pflicht.
- `Startzeit` und `Endzeit` sind fachlich Zeiten im Format `HH:MM`. Google-Sheets-Zeitwerte werden beim Einlesen auf dieses Format normalisiert.
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
- E-Mail-Empfänger fuer Erinnerungen, Absagen und Trainerberichte werden direkt aus diesem Tab gelesen.

## 2. Öffentliches Trainings-Sheet
Unterstützt wird ausschließlich die Struktur mit einer Zeile pro Mitglied und einer Datumsspalte pro Session.

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
- Jede `Trainingsdefinitionen`-Zeile einer Quelle muss im oeffentlichen Blatt mindestens einer Datums-Spalte mit passendem Wochentag zugeordnet werden koennen.
- Eine Quelle kann im oeffentlichen Blatt zusaetzliche Datums-Spalten fuer nicht konfigurierte Wochentage enthalten. Diese Spalten werden mit einer Warnung uebersprungen.
- Die Zuordnung zur passenden `TrainingsId` erfolgt ueber `Trainingsdefinitionen.Wochentag`.
- Wenn `InfoZeile` konfiguriert ist, wird der Zelleninhalt dieser Zeile pro Datumsspalte als zusaetzliche Session-Information gelesen.
- Eine Session gilt als abgesagt, wenn dieser Text `entfällt` oder `gesperrt` enthaelt, zum Beispiel `Halle gesperrt`.
- Abgesagte Sessions akzeptieren keine Zu- oder Absagen und erhalten keine normalen Erinnerungsmails.

## 3. Registrierung über die Web-App
Pflichtparameter:

- `action=register`
- `email`
- `role`
- `gender`
- `firstName`
- `lastName`

Registrierung legt Identität und Rolle an, verwaltet aber keine Trainings-Abonnements.

## 4. Benachrichtigungseinstellungen über die Web-App
Pflichtparameter:

- `action=preferences`
- `memberId`
- `subscribedTrainingIds`

`subscribedTrainingIds` ist eine komma- oder semikolon-getrennte Liste von `TrainingsId`-Werten aus `Trainingsdefinitionen`. Ein leerer Wert leert die Abonnements der Person.

## 5. Validierung
Typische Fehler sind fehlende Konfigurationsschlüssel, fehlende Spalten im Tab `Mitglieder` oder unvollständige Trainingsdefinitionen.

Kurz: Das System unterstützt genau ein privates Schema und genau eine öffentliche Tabellenstruktur.
