# Logging-Konzept

## Ziel
Das Logging soll dem Maintainer helfen, Fehler in der produktiven oder Entwicklungs-Umgebung schnell zu finden und das Laufzeitverhalten der Web-App- und Trigger-Einstiegspunkte nachzuvollziehen.

## Grundsätze
- Logging ist ein internes Betriebswerkzeug und nicht für Mitglieder oder Trainer bestimmt.
- Logs werden nur im privaten Script-Kontext gespeichert.
- Es werden keine personenbezogenen Daten geloggt.
- Die Logs dienen primär zur Verifikation von Deployments, Trigger-Läufen und Fehlerfällen.

## Was wird geloggt?
- Start und Ende von `doGet`, `doPost`, `runReminderDispatch`, `runTrainerParticipationReport` und `runTrainerParticipationReportDispatch`
- Erfolgswerte wie `sentCount` oder `sessionsProcessed`
- Sanitized Fehlerereignisse mit Operation, Zeitstempel und technischem Kontext

## Was wird nicht geloggt?
- E-Mail-Adressen
- Klarnamen
- Sheet-IDs oder Web-App-URLs
- rohe Konfigurationswerte aus Script Properties oder der privaten Konfigurationstabelle

## Ablage und Rotation
- Zur schnellen Analyse werden Log-Einträge zusätzlich in den Apps-Script-Ausführungslogs ausgegeben.
- Für den Maintainer wird im privaten, container-bound Sheet ein Tab `Systemprotokoll` verwendet.
- Das Protokoll wird wochenweise geführt.
- Beim ersten Log-Eintrag einer neuen Kalenderwoche wird das Blatt geleert und mit Kopfzeile neu begonnen.

## Umsetzung
- Die Logging-Logik wird als kleine Laufzeit-Komponente umgesetzt.
- Die Einstiegspunkte im Runtime-Layer schreiben Start-, Erfolgs- und Fehler-Einträge.
- Öffentliche Antworten an Web-App-Aufrufer bleiben generisch; Detailinformationen stehen nur im internen Log.

## Verifikation
- Nach dem Deployment kann der Maintainer im Tab `Systemprotokoll` prüfen, ob Requests und Trigger erfolgreich gelaufen sind.
- Fehlerfälle sind dort als `ERROR` sichtbar.
- Für Detailanalyse stehen zusätzlich die Apps-Script-Ausführungslogs zur Verfügung.