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

| SourceId | DateiId | TabellenName | TabellenBereich | Layout | VornameSpalte | NachnameSpalte | StartSpalte |
|----------|---------|--------------|-----------------|--------|---------------|----------------|-------------|
| `club-rsvp` |  | `RSVP Übersicht` | `A1:AZ200` | `member-rows` | `A` | `B` | `C` |

`Layout` muss `member-rows` sein.

### Tab `Trainingsdefinitionen`

| SourceId | TrainingsId | Titel | Wochentag | Startzeit | Endzeit | Ort | Umgebung | Typ | Beschreibung |
|----------|-------------|-------|-----------|-----------|---------|-----|-----------|-----|--------------|
| `club-rsvp` | `wed-mixed` | `Mittwoch Training` | `Mittwoch` | `18:00` | `20:00` | `Sporthalle` | `Indoor` | `Mixed` |  |

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

| Vorname | Nachname | 2026-03-11 | 2026-03-18 | 2026-03-25 |
|---------|----------|------------|------------|------------|
| Max | Mustermann | `x` | `-` |  |
| Anna | Admin |  | `x` | `x` |

Regeln:
- Eine Zeile pro Mitglied.
- Eine Datumsspalte pro Session.
- `x` für Zusage, `-` für Absage, leer für keine Antwort.
- Die App gleicht jede Zeile gegen `Mitglieder` ab.
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
