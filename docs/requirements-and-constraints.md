# Anforderungen und Einschränkungen — Trainings RSVP System

Dieses Dokument zentralisiert die Projektanforderungen und Einschränkungen für den Trainings [RSVP](https://en.wikipedia.org/wiki/RSVP)-Workflow.

## Funktionale Anforderungen

### FR-1 RSVP-Regestrierung
- Bereitstellung eines einfachen Google-Formulars zur Mitgliederregistrierung.
- Erfassung Namen und E-Mail-Adresse. Der Name MUSS mit dem Sheet Namen übereinstimmen.
- Erfassung, für welche Trainings die Benachrichtigung gelten sollen (z.b. Montag, Mittwoch...)
- Erfassung des bevorzugten RSVP-Kanals: `E-MAIL`, `KALENDER` oder `BEIDE`.
- Unterscheidung zwischen Trainer und Mitglied (siehe User Management)

### FR-2 Wöchentliche Trainingserinnerung
- Versenden automatisierter wöchentlicher Erinnerungen vor jeder Trainingseinheit, wenn Mitglied registriert ist und keine Rückmeldung gegeben hat.
- Information: Indoor/Outdoor, Uhrzeit, Ort des Trainings
- Typ des Trainings kann angegeben werden (single-gender oder mixed), evtl. weitere Informationen.
- Zustellung nach Mitgliederpräferenz:
  - E-Mail-Erinnerung mit RSVP-Aktionen,
  - Kalendereinladung,
  - oder beides.

### FR-3 One-Click RSVP
- Unterstützung von One-Click-Zusage/Absage via E-Mail-Link zur Apps Script Web App.
- Unterstützung von One-Click-Zusage/Absage via Google Kalender Teilnehmerantwort.
- Mitglieder benötigen niemals direkten Zugriff auf das Trainingsblatt für die RSVP (trotzdem möglich).

### FR-4 Blatt-Synchronisierung (Sheet-Sync)
- Synchronisierung der RSVP-Ergebnisse aus E-Mail und Kalender in die Anwesenheitszellen.
- Manuelle Bearbeitungen durch den Trainer sind jederzeit möglich.
- Manuelle Werte dürfen nicht überschrieben werden, außer es geht eine neuere explizite RSVP nach der manuellen Änderung ein.
- Gewährleistung einer deterministischen Konfliktlösung mittels Quelle + Zeitstempel-Metadaten.
- Trainings 

### FR-5 Benachrichtigung bei Trainingsabsage
- Ermöglichen einer Trainer-ausgelösten Absage über eine einzelne Aktion im Blatt (z. B. Kontrollzelle/Checkbox).
- Versenden einer Absage-E-Mail an alle registrierten Mitglieder und sagt Terminevent im Kalender ab.

### FR-6 Benachrichtigung der Trainer über Trainingsbeteiligung
- Nur für Trainer (siehe User Management)
- Trainer erhalten vor dem Training Auskunft per Mail bezüglich der Trainingsbeteiligung (abhängig von Geschlecht)

### FR-7 Zugriff auf Kontaktdaten
- Beschränkung der E-Mail-Sichtbarkeit auf die Trainer-/Admin-Rolle.
- Gemeinsam genutzte Ansichten des Trainingsblatts dürfen keine E-Mail-Adressen von Mitgliedern offenlegen.

### FR-8 User Management
- Unterscheidung zwischen Mitglied und Trainer (und Interessent?)
- Trainer verfügen über mehr Berechtigungen:
  - Absage von Trainings
  - Erhalten Trainingsbeteiligung

### FR-9 Statistiken (optional)
- Statistiken über Trainingsbeteiligung (abhängig von der Zeit/Training)

### FR-10 Turnierbenachrichtigung (optional)

## Qualitäts Anforderungen (ISO-25010)

### Priority 1
- Functional Suitability: Functional Correctness
- Interaction Capability: Operarbility

### Priority 2
- Security: Confidentiality
- Maintainability: Modifiability
- Compatibility: Co-Existence (mit bisherigem Trainingssheet Workflow)

## Einschränkungen

### Kosten
- Nur Einsatz von kostenlosen Tools

### Technische Einschränkungen
- Verwendung ausschließlich nativer Google Workspace Free-Tier-Tools: Sheets, Forms, Kalender, Gmail, Apps Script, Groups (optional).
- Keine Drittanbieter-Automatisierungen/Dienste ohne ausdrückliche Genehmigung.

### Datenbeschränkungen
- Persistierung von Kontaktdaten ausschließlich im Backend-Tab (`Backend DB`).
- Sicherstellen, dass Kontaktdaten für reguläre Betrachter des Blattes unzugänglich bleiben.

### Datenbackend
- Das Trainingsblatt bleibt die "Single Source of Truth".
