## Anforderungen

Ziel ist es, die Teilnahme Rückmeldungen zum Training zu erhöhen, indem Rückmeldungen vereinfacht werden und Erinnerungen versendet werden können. Zu diesem Zweck soll ein [RSVP](https://en.wikipedia.org/wiki/RSVP) System entwickelt werden.

## Stakeholders

| Rolle    | Beschreibung                                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Mitglied | Erteilt Zu/Absagen für Trainingseinheiten über einen E-Mail-basierten RSVP-Service, wenn registriert.                       |
| Trainer  | Gleiche Berechtigungen wie das Mitglied. Erhält zusätzlich Berichte über Trainingsbeteiligung und kann das Training absagen. |

# Funktionale Anforderungen

### FR-1 RSVP-Regestrierung
- Bereitstellung eines einfachen Google-Formulars zur Mitgliederregistrierung.
- Erfassung Namen und E-Mail-Adresse. Der Name MUSS mit dem Sheet Namen übereinstimmen.
- Erfassung, für welche Trainings die Benachrichtigung gelten sollen (z.b. Montag, Mittwoch...)
- Unterscheidung zwischen Trainer und Mitglied (siehe User Management)

### FR-2 Wöchentliche Trainingserinnerung
- Versenden automatisierter wöchentlicher Erinnerungen vor jeder Trainingseinheit, wenn Mitglied registriert ist und keine Rückmeldung gegeben hat.
- Information: Indoor/Outdoor, Uhrzeit, Ort des Trainings
- Typ des Trainings kann angegeben werden (single-gender oder mixed), evtl. weitere Informationen.
- Zustellung als E-Mail-Erinnerung mit RSVP-Aktionen.

### FR-3 One-Click RSVP
- Unterstützung von One-Click-Zusage/Absage via E-Mail-Link zur Apps Script Web App.
- Mitglieder benötigen niemals direkten Zugriff auf das Trainingsblatt für die RSVP (trotzdem möglich).

### FR-4 Blatt-Synchronisierung (Sheet-Sync)
- Synchronisierung der RSVP-Ergebnisse aus E-Mails in die Anwesenheitszellen.
- Manuelle Bearbeitungen durch den Trainer sind jederzeit möglich.
- Manuelle Werte dürfen nicht überschrieben werden, außer es geht eine neuere explizite RSVP nach der manuellen Änderung ein.
- Gewährleistung einer deterministischen Konfliktlösung mittels Quelle + Zeitstempel-Metadaten.
- Trainings 

### FR-5 Benachrichtigung bei Trainingsabsage
- Ermöglichen einer Trainer-ausgelösten Absage über eine einzelne Aktion im Blatt (z. B. Kontrollzelle/Checkbox).
- Versenden einer Absage-E-Mail an alle registrierten Mitglieder.

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

## Qualitäts Ziele (ISO-25010)

### Priority 1
- Functional Suitability: Functional Correctness
- Interaction Capability: Operarbility

### Priority 2
- Security: Confidentiality
- Maintainability: Modifiability
- Compatibility: Co-Existence (mit bisherigem Trainingssheet Workflow)
