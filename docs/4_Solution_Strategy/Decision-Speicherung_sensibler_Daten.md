## Einleitung

Ziel ist es, ein RSVP-System für Trainings zu bauen, bei dem das bestehende Trainings-Sheet **öffentlich** bleibt, während **E-Mail-Adressen**, Rollen (Mitglied/Trainer) und Konfigurationswerte geschützt gespeichert werden. Es stehen dafür zwei Varianten zur Auswahl, die beide auf einem separaten, nicht öffentlichen Bereich für sensible Daten basieren:

- **Option 1:** Öffentliches Haupt-Sheet + private, zugriffsbeschränkte Google-Tabelle (mit Apps Script) für Konfiguration und Userdaten  
- **Option 2:** Öffentliches Haupt-Sheet + Standalone Apps Script, das sensible Konfiguration über die `PropertiesService`-API verwaltet und optional eine private Tabelle für Userdaten nutzt

Dieses Dokument vergleicht die Optionen entlang der relevanten [[1_Introduction_and_Goals|Anforderungen]] (FR‑1..FR‑8) und Qualitätsziele (Funktionale Eignung, Sicherheit, Wartbarkeit, Koexistenz) und spricht eine Empfehlung aus.

---

## Kontext & gemeinsame Basis

Beide Optionen gehen von folgendem Setup aus:

- Das **öffentliche Trainings-Sheet** bleibt Single Source of Truth für Termine, Anwesenheit, Absagen usw.
- RSVP-Flows laufen über:
  - Google Form für Registrierung (FR‑1)
  - E-Mail-/Kalender-Erinnerungen mit One‑Click‑RSVP (FR‑2, FR‑3)
  - Web-App-Endpunkte für RSVP und Traineraktionen (FR‑3, FR‑5, FR‑6)
- Trainer und Mitglieder erhalten **keinen direkten Zugriff** auf sensible Daten (E-Mail-Adressen, Rollen, Konfigurationswerte).
- Das ausführende Apps Script läuft unter deinem Account und hat Zugriff auf:
  - Öffentliches Trainings-Sheet (lesen/schreiben)
  - Einen privaten Bereich für sensible Daten (konfigurationsabhängig Option 1 oder 2)

---

## Option 1: Öffentliches Haupt-Sheet + private, zugriffsbeschränkte Tabelle (mit App Script)

### Architektur

- **Haupt-Sheet (öffentlich)**  
  - Enthält Trainings, Anwesenheit, Metadaten (Indoor/Outdoor, Uhrzeit, Ort, Typ, ggf. anonymisierte IDs).
  - Kann für Transparenz weiterhin Namen enthalten, aber keine E-Mail-Adressen.
- **Private “User & Config”-Tabelle (nicht öffentlich)**  
  - Enthält: Name, E-Mail, Rolle (Mitglied/Trainer), abonnierte Trainings, bevorzugter Kanal.
  - Enthält zusätzlich Konfigurationswerte: IDs, Flags, Timing-Parameter, Feature-Toggles.
  - Nur eng begrenzter Personenkreis (du/Admins) hat Edit-Zugriff.
- **Apps Script** (empfohlen als Standalone, technisch aber auch bound an die private Tabelle möglich)  
  - Liest Trainingstermine aus dem öffentlichen Sheet.
  - Liest User & Rollen + Konfiguration aus der privaten Tabelle.
  - Schreibt Anwesenheitswerte und Status in das öffentliche Sheet (FR‑4), respektiert manuelle Änderungen inkl. Zeitstempeln.
  - Implementiert Web-App für One‑Click‑RSVP und Traineraktionen.

### Bewertung nach Anforderungen

- **FR‑1 Registrierung:**  
  - Google Form schreibt in die private Tabelle (neues Tab „Registrierung“ oder direkt in die User-Tabelle).  
  - Name muss identisch mit dem Namen im Trainingssheet sein – Matching über Name oder eine interne ID.  
- **FR‑2/FR‑3/FR‑4 (Erinnerungen + One‑Click + Sync):**  
  - Script liest aus beiden Tabellen, verschickt Erinnerungen und synchronisiert Ergebnisse deterministisch (Quelle + Zeitstempel).  
- **FR‑5/FR‑6/FR‑7/FR‑8 (Trainerrechte, Berichte, Datenschutz):**  
  - Trainer-Rollen stehen in der privaten Tabelle; das Script entscheidet, welche Aktionen/Ansichten ein Benutzer bekommt.  
  - Öffentliche Sheet-Ansichten enthalten keine E-Mail-Adressen; alle Kontaktdaten liegen in der privaten Tabelle.

### Qualitätsziele

- **Functional Suitability:**  
  - Volle Kontrolle über Datenmodell in der privaten Tabelle (mehrspaltig, normalisiert, gut sichtbar für Admins).
- **Sicherheit / Vertraulichkeit:**  
  - Stark abhängig von **Drive-Sharing-Disziplin**: Wird die private Tabelle versehentlich mit „Editor“ an falsche Personen geteilt, sind alle E-Mail-Adressen & Konfigs sichtbar.  
  - Keine zusätzliche technische Absicherung außer Google-Drive-Berechtigungen.
- **Wartbarkeit / Modifizierbarkeit:**  
  - Vorteil: Admins können Konfiguration und Userdaten über die UI der Tabelle pflegen (kein Code-Deployment notwendig).  
  - Nachteil: Strukturänderungen (Spalten, Tablayout) können Scripts brechen; Refactorings brauchen Abstimmung zwischen „Sheet-Admin“ und „Entwickler“.
- **Ko-Existenz mit bestehendem Workflow:**  
  - Sehr gut; das bestehende öffentliche Sheet bleibt nahezu unverändert, „User & Config“-Logik liegt sauber ausgelagert in der privaten Tabelle.

---

## Option 2: Öffentliches Haupt-Sheet + Standalone Apps Script mit PropertiesService

### Architektur

- **Haupt-Sheet (öffentlich)**  
  - Wie in Option 1.
- **Standalone Apps Script Projekt**  
  - Enthält Business-Logik, Web-App, Trigger.  
  - Nutzt `PropertiesService` für:
    - Konfiguration (Sheet-IDs, Basis-URLs, Timing, Feature-Flags).  
    - Optional: Serialisierte Userdaten, sofern in Umfang und Änderungsfrequenz überschaubar.  
- **Optionale private User-Tabelle**  
  - Wenn die Userliste größer oder häufig änderbar ist, können User + Rollen analog zu Option 1 in einer privaten Tabelle liegen.  
  - Die Entscheidung wird dann:  
    - *Konfiguration in PropertiesService*  
    - *Userdaten in privater Tabelle*

### Bewertung nach Anforderungen

- **FR‑1 Registrierung:**  
  - Google Form schreibt wahlweise in eine private User-Tabelle oder der Registrierungs-Handler im Script aktualisiert direkt `PropertiesService` (z. B. JSON-Blob mit Usern).  
- **FR‑2/FR‑3/FR‑4:**  
  - Setup wie in Option 1, aber Konfiguration (z. B. welche Trainings existieren, Zeitpunkt der Erinnerungen, RSVP-URL-Token-Länge) steht in Properties statt in Zellen.
- **FR‑5/FR‑6/FR‑7/FR‑8:**  
  - Rollenverwaltung kann in einer privaten Tabelle (ähnlich Option 1) oder in Script Properties erfolgen.  
  - Für größere Trainer-/Mitgliederzahlen ist eine Tabelle meist übersichtlicher, Properties reichen gut für technisch/statische Settings.

### Qualitätsziele

- **Functional Suitability:**  
  - Für Konfiguration und moderate Datenmengen (IDs, Limits, Flags, kleine Usergruppe) ist `PropertiesService` sehr gut geeignet.  
  - Für häufig änderbare, große Userlisten wird es unhandlich (JSON-Update-Code nötig, potenziell Konflikte bei parallelen Updates).
- **Sicherheit / Vertraulichkeit:**  
  - Script Properties sind nur für Script-Editoren sichtbar; sie sind nicht an Tabellen-Berechtigungen gekoppelt.  
  - Selbst wenn jemand versehentlich ein „privates Konfig-Sheet“ teilen würde, bleiben Properties unangetastet.  
- **Wartbarkeit / Modifizierbarkeit:**  
  - Technische Konfiguration lässt sich sauber versionieren und via Code (Init-Funktionen) pflegen.  
  - Für Nicht-Entwickler ist die Bearbeitung von Properties jedoch weniger intuitiv als eine Tabelle.  
  - Gute Passung zu deinem `clasp` + TypeScript-Setup und CI/CD.
- **Ko-Existenz mit bestehendem Workflow:**  
  - Bestehendes Sheet bleibt unberührt; Script-Verhalten ist überwiegend über Properties und Code gesteuert.

---

## Relevante Entscheidungsdimensionen

### 1. Datenvolumen & Änderungsfrequenz der Userliste

- **Klein, eher statisch (z. B. < 100–200 Leute, seltene Änderungen):**  
  - Option 2 (User in Properties) ist technisch machbar; Updates laufen über Admin-Funktionen oder automatisiert aus dem Registrierungs-Flow.  
- **Mittel/groß, häufige Änderungen (neue Mitglieder, Rollenwechsel, Trainingspräferenzen):**  
  - Option 1 (User in privater Tabelle) ist deutlich angenehmer in der Pflege und transparent für die Trainer/Admins, und Option 2 nutzt Properties nur für echte Konfiguration.

### 2. Wer soll Konfiguration/Benutzer pflegen?

- **Nur technischer Maintainer:**  
  - Properties sind okay; Maintainer kannst Admin-Funktionen schreiben, um Werte zu setzen/lesen.  
- **Nicht-technische Trainer/Admins sollen selbst konfigurieren (z. B. Trainingszeiten, Default-Einstellungen, Rollenwechsel):**  
  - Eine private Tabelle ist das natürlichere UI – Option 1 (oder Option 2 mit zusätzlicher privater Tabelle für diese Daten).

### 3. Sicherheitsrisiko durch „Fehl-Sharing“

- **Option 1:**  
  - Risiko: Die private Tabelle kann versehentlich „weitergegeben“ werden, womit alle E-Mails sichtbar würden.  
- **Option 2:**  
  - Script Properties sind an das Script gebunden; ein versehentliches Freigeben eines Sheets berührt sie nicht.  
  - Wenn eine zusätzliche private User-Tabelle genutzt wird, besteht für die Userdaten das gleiche Risiko wie in Option 1, aber Konfig-Sektionen bleiben in Properties geschützt.

---

## Decision

Umsetzung von Option 1, da Konfigurationen klarer ersichtlich und veränderbar sind, während andere Requirements/Qualitätsziele wie Security kaum oder gar nicht beeinträchtigt sind.



