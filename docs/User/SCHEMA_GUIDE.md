# Schema-Anleitung – Google Sheets Definitionen

Dieses Dokument beschreibt die einzige unterstützte Tabellenstruktur für das RSVP-System. Die Anwendung erwartet einen festen privaten Konfigurationsaufbau und ein öffentliches Trainingsblatt mit Mitgliederzeilen und Datumsspalten.

## 1. Private Systemtabelle
Dieses Spreadsheet ist das container-gebundene private Apps-Script-Sheet. Es enthält Konfiguration, Trainingsdefinitionen, private Mitgliederdaten und laufzeitinterne Metadaten und muss privat bleiben.

Erforderliche Tabs:
- `Konfiguration`
- `Trainingsquellen`
- `Trainingsdefinitionen`
- `Mitglieder`

Laufzeit-Tabs:
- `VersandMetadaten`
- `ErinnerungsVersandMetadaten`
- `LaufzeitMetadaten`

Die Laufzeit-Tabs werden von der Anwendung selbst verwendet, um interne Metadaten ausserhalb des oeffentlichen Sheets zu speichern. Sie werden bei der ersten schreibenden Verwendung automatisch mit den erwarteten Headern angelegt.

### Tab `Konfiguration`
Der Tab wird als Key-Value-Tabelle gelesen.

| Schlüssel | Wert |
|-----------|------|

Erforderliche Schlüssel:

| Schlüssel | Beispielwert | Bedeutung |
|-----------|--------------|-----------|
| `OEFFENTLICHES_SHEET_ID` | `[Google Sheet ID]` | ID des öffentlichen Trainings-Sheets |
| `WEBAPP_ADRESSE` | `https://script.google.com/.../exec` | Deploy-URL der Web-App für RSVP-Links |
| `ERINNERUNGS_STUNDEN` | `48;24` | Semikolon-getrennte, nicht-negative Ganzzahlen in Stunden vor dem Training |

### Tab `Trainingsquellen`

| QuellenId | TabellenName | TabellenBereich | DatumsKopfZeile | InfoZeile | MitgliederStartZeile | VornameSpalte | NachnameSpalte | GeschlechtSpalte | StartSpalte |
|-----------|--------------|-----------------|-----------------|-----------|----------------------|---------------|----------------|------------------|-------------|
| `club-rsvp` | `RSVP Übersicht` | `A1:AZ200` | `2` | `1` | `6` | `A` | `B` | `C` | `E` |

Regeln:
- `QuellenId` ist eine stabile interne Kennung fuer diese Trainingsquelle.
- `QuellenId` verknuepft die Zeile in `Trainingsquellen` mit den Zeilen in `Trainingsdefinitionen` und ist Teil der erzeugten `sessionId`.
- `QuellenId` ist nicht der Tabname. Der eigentliche Name des Arbeitsblatts im oeffentlichen Trainings-Sheet steht in `TabellenName`.
- `TabellenName` meint also den sichtbaren Tabnamen des Arbeitsblatts innerhalb des ueber `OEFFENTLICHES_SHEET_ID` referenzierten Spreadsheets, zum Beispiel `RSVP Übersicht`.
- `DatumsKopfZeile` ist die absolute Zeilennummer im oeffentlichen Blatt, in der die eigentlichen Datums-Header stehen.
- `InfoZeile` ist optional. Wenn gesetzt, wird in dieser absoluten Zeile pro Datumsspalte zusaetzliche Session-Information gelesen.
- `MitgliederStartZeile` ist die absolute Zeilennummer im oeffentlichen Blatt, in der die erste echte Mitgliederzeile beginnt.
- `GeschlechtSpalte` ist optional. Wenn sie gesetzt ist, berücksichtigt die Web-App beim Registrierungs-Abgleich auch das Geschlecht.
- `InfoZeile` muss vor `MitgliederStartZeile` liegen.
- Das oeffentliche Spreadsheet wird immer ueber `OEFFENTLICHES_SHEET_ID` aus `Konfiguration` bestimmt. Eine separate `DateiId` pro Quelle gibt es nicht.

### Tab `Trainingsdefinitionen`

| QuellenId | TrainingsId | Titel | Wochentag | Startzeit | Endzeit | Ort | Umgebung |
|-----------|-------------|-------|-----------|-----------|---------|-----|-----------|
| `club-rsvp` | `wed-mixed` | `Mittwoch Training` | `Mittwoch` | `18:00` | `20:00` | `Sporthalle` | `Indoor` |

Regeln:
- Dieser Tab wird nicht automatisch aus dem oeffentlichen Sheet erzeugt oder synchronisiert.
- Er muss manuell gepflegt werden, wenn neue Trainingsarten, Zeiten oder Orte hinzukommen oder sich aendern.
- Die Anwendung liest diese Definitionen nur ein, um Sessions und Erinnerungen fachlich anzureichern.
- `Wochentag` ist Pflicht.
- `Startzeit` und `Endzeit` sind fachlich Zeiten im Format `HH:MM`. Google-Sheets-Zeitwerte werden beim Einlesen auf dieses Format normalisiert.
- Eine Quelle darf mehrere Trainingsdefinitionen enthalten.
- Innerhalb einer Quelle muss jeder `Wochentag` eindeutig sein, damit jede Datumsspalte genau einer `TrainingsId` zugeordnet werden kann.

### Tab `Mitglieder`

| Vorname | Nachname | Geschlecht | EMail | Rolle | AbonnierteTrainingsIds | MitgliedId |
|---------|----------|------------|-------|-------|------------------------|------------|
| `Max` | `Mustermann` | `m` | `max.mustermann@email.com` | `Mitglied` | `wed-mixed` | `max::mustermann` |
| `Anna` | `Admin` | `w` | `anna@email.com` | `Trainer` | `wed-mixed` | `anna::admin` |

Regeln:
- Die `MitgliedId` wird beim ersten Schreiben automatisch als normalisierte Form von `Vorname::Nachname` berechnet und stabil im Tab gespeichert. Sie darf danach nicht mehr geändert werden.
- Doppelte Kombinationen aus `Vorname` und `Nachname` sind nicht erlaubt. Solche Zeilen muessen vor dem Betrieb bereinigt werden.
- `EMail` dient nur dem Versand von Benachrichtigungen und ist kein Identitaetsschluessel.
- `Rolle` darf nur `Mitglied` oder `Trainer` sein.
- Alle Personen, die RSVP oder Benachrichtigungen nutzen, müssen in diesem Tab vorhanden sein.
- E-Mail-Empfänger fuer Erinnerungen und Absagen werden direkt aus diesem Tab gelesen.

### Tab `VersandMetadaten`

| SessionId | AbsageBenachrichtigungGesendetAm |
|-----------|----------------------------------|
| `club-rsvp__wed-mixed__2026-03-11__18:00` | `2026-03-10T12:30:00.000Z` |

Regeln:
- Eine Zeile pro `SessionId`.
- Der Zeitstempel ist ein ISO-8601-Wert.
- Die Anwendung nutzt diesen Tab ausschliesslich als Idempotenz-Schutz fuer bereits verschickte Absage-Benachrichtigungen.

### Tab `ErinnerungsVersandMetadaten`

| SessionId | OffsetMinuten | GesendetAm |
|-----------|---------------|------------|
| `club-rsvp__wed-mixed__2026-03-11__18:00` | `2880` | `2026-03-09T18:05:00.000Z` |

Regeln:
- Eine Zeile pro Kombination aus `SessionId` und `OffsetMinuten`.
- `OffsetMinuten` ist der konfigurierte Erinnerungsabstand in Minuten, zum Beispiel `2880` fuer 48 Stunden.
- `GesendetAm` ist ein ISO-8601-Zeitstempel.
- Die Anwendung nutzt diesen Tab als Idempotenz-Schutz fuer bereits verschickte Reminder pro Session und Reminder-Offset.

### Tab `LaufzeitMetadaten`

| Schluessel | Wert |
|------------|------|
| `runReminderDispatch:lastSuccessfulRunAt` | `2026-03-09T18:15:00.000Z` |

Regeln:
- Eine Zeile pro Laufzeit-Schluessel.
- `Wert` ist ein ISO-8601-Zeitstempel oder ein anderer interner String-Wert.
- Fuer Reminder nutzt die Anwendung aktuell den Schluessel `runReminderDispatch:lastSuccessfulRunAt`.
- Der Zeitstempel wird nur nach einem erfolgreichen Reminder-Lauf aktualisiert und dient als Startpunkt fuer die naechste Catch-up-Auswertung.

## 2. Öffentliches Trainings-Sheet
Unterstützt wird ausschließlich die Struktur mit einer Zeile pro Mitglied und einer Datumsspalte pro Session.

| Kategorie | Kategorie | Kategorie | 2026-03-11 | 2026-03-18 | 2026-03-25 |
|-----------|-----------|-----------|------------|------------|------------|
| Zusagen |  |  | 22 | 5 | 5 |
| Max | Mustermann | m | `x` | `-` |  |
| Anna | Admin | w |  | `(x)` | `x` |

Regeln:
- Eine Zeile pro Mitglied.
- Eine Datumsspalte pro Session.
- `x` für Zusage, `(x)` für Unsicher, `-` für Absage, leer für keine Antwort.
- Nicht-Mitgliederzeilen oberhalb von `MitgliederStartZeile` werden ignoriert.
- Die eigentliche Datumszeile wird ueber `DatumsKopfZeile` konfiguriert und muss nicht die erste Zeile des Bereichs sein.
- Die App gleicht jede Zeile ab `MitgliederStartZeile` gegen `Mitglieder` ab.
- Fuer den Registrierungs-Abgleich gilt: Vorname und Nachname muessen eindeutig passen. Zeilen mit nur einem Vornamen werden als mehrdeutig markiert und nie automatisch als Treffer gewertet.
- Jede `Trainingsdefinitionen`-Zeile einer Quelle muss im oeffentlichen Blatt mindestens einer Datums-Spalte mit passendem Wochentag zugeordnet werden koennen.
- Eine Quelle kann im oeffentlichen Blatt zusaetzliche Datums-Spalten fuer nicht konfigurierte Wochentage enthalten. Diese Spalten werden mit einer Warnung uebersprungen.
- Die Zuordnung zur passenden `TrainingsId` erfolgt ueber `Trainingsdefinitionen.Wochentag`.
- Wenn `InfoZeile` konfiguriert ist, wird der Zelleninhalt dieser Zeile pro Datumsspalte als zusaetzliche Session-Information gelesen.
- Eine Session gilt als abgesagt, wenn dieser Text `entfällt` oder `gesperrt` enthaelt, zum Beispiel `Halle gesperrt`.
- Abgesagte Sessions akzeptieren keine Rückmeldungen und erhalten keine normalen Erinnerungsmails.
- Trainer erhalten in Reminder-Mails zusätzlich einen Web-App-Link `action=cancel-training`. Dieser Link zeigt zuerst eine Bestätigungsseite und schreibt die Absage erst nach POST-Bestätigung in die `InfoZeile`.

## 3. Registrierung über die Web-App
Die Registrierungsseite ist unter `WEBAPP_ADRESSE?action=join` erreichbar.

Pflichtparameter:

- `action=register`
- `email`
- `gender`
- `firstName`
- `lastName`

Öffentliche Registrierung legt immer eine Identität mit der Rolle `Mitglied` an und verwaltet keine Trainings-Abonnements. Eine spätere Umstellung auf `Trainer` erfolgt ausschließlich durch die Script-Administration.

Nach dem ersten Registrierungsschritt zeigt die Web-App pro ausgewähltem Training den zugehörigen Tab im öffentlichen Trainings-Sheet und erklärt, ob die Person dort bereits eingetragen ist oder beim Speichern automatisch ergänzt wird. Zeilen mit passendem Vornamen, aber leerem Nachnamen werden bei diesem Abgleich ignoriert.

Existiert fuer `Vorname` und `Nachname` bereits ein Mitglied, behandelt die Web-App diesen Schritt als Aktualisierung des bestehenden Mitglieds. Im zweiten Schritt werden die aktuellen Abonnements vorausgewählt, und die Seite zeigt die derzeit registrierte E-Mail-Adresse an.

Nach dem zweiten Registrierungsschritt schreibt die Web-App die gewählten Trainings-Abonnements in den privaten Tab `Mitglieder`. Gleichzeitig erklärt die Oberfläche, dass Zu- und Absagen aus den Erinnerungsmails das öffentliche Trainings-Sheet aktualisieren. Falls eine ausgewählte Trainingsquelle im öffentlichen Blatt den Status `not-found` hat, fügt die Anwendung zusätzlich eine neue Mitgliederzeile am Ende des konfigurierten Mitgliederbereichs dieses Tabs ein. Quellen mit `matched` oder `gender-mismatch` werden nicht automatisch ergänzt. Zeilen mit passendem Vornamen, aber leerem Nachnamen gelten in diesem Schritt ebenfalls als `not-found`.

## 4. Benachrichtigungseinstellungen über die Web-App
Pflichtparameter:

- `action=preferences`
- `memberId`
- `subscribedTrainingIds`

`subscribedTrainingIds` ist eine komma- oder semikolon-getrennte Liste von `TrainingsId`-Werten aus `Trainingsdefinitionen`. Ein leerer Wert leert die Abonnements der Person.

Dieselbe Preferences-Seite wird sowohl im zweiten Schritt der Registrierung als auch ueber den Reminder-Mail-Link `Benachrichtigungseinstellungen aktualisieren` fuer spaetere Aenderungen der Benachrichtigungseinstellungen verwendet.

## 5. Validierung
Typische Fehler sind fehlende Konfigurationsschlüssel, fehlende Spalten im Tab `Mitglieder` oder unvollständige Trainingsdefinitionen.

Kurz: Das System unterstützt genau ein privates Schema und genau eine öffentliche Tabellenstruktur.
