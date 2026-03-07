# Teststrategie für das RSVP-System (Google Apps Script)

## Einleitung

Da die Entwicklung lokal erfolgt, die ausführenden Google-APIs jedoch nur in der Cloud zur Verfügung stehen, erfordert die Qualitätssicherung einen mehrstufigen Ansatz. Die Teststrategie zielt darauf ab, Fehler frühzeitig lokal abzufangen und Seiteneffekte in der Cloud abzusichern, ohne die genaue technische Implementierung vorzuschreiben.

---

## 1. Lokale Unit-Tests (Geschäftslogik)

Das Ziel dieser Ebene ist die verzögerungsfreie Überprüfung der Kernlogik ohne Abhängigkeit von Google-Diensten.

*   **Architekturprinzip:** Strikte Entkopplung der Datenbeschaffung (Google-API-Aufrufe) von der Datenverarbeitung.
*   **Durchführung:** Funktionen für komplexe Anforderungen (z. B. Konfliktauflösung der RSVP-Zeitstempel oder Rollenvalidierung) nehmen Daten ausschließlich über Standard-Parameter entgegen. Diese werden in einer lokalen Testumgebung (z. B. mit Jest) durch Mock-Daten validiert.

## 2. Cloud-Staging-Umgebung (Daten-Sandbox)

Für die Überprüfung der tatsächlichen Interaktion mit Tabellen und Diensten wird eine isolierte Umgebung in der Google-Cloud benötigt.

*   **Architekturprinzip:** Vollständige Duplikation der Datenquellen.
*   **Durchführung:** Es werden separate Test-Kopien des öffentlichen Haupt-Sheets sowie der privaten Daten-Tabelle erstellt. Diese Sandbox wird ausschließlich mit Dummy-Daten und kontrollierten E-Mail-Adressen des Entwicklungsteams befüllt. Die Umgebung wird über einen Konfigurationsparameter explizit als Entwicklungsmodus deklariert.

## 3. Umgebungsmanagement (Deployment)

Ein unkontrolliertes Überschreiben des produktiven Systems muss beim Ausrollen des Codes technisch ausgeschlossen werden.

*   **Architekturprinzip:** Trennung der Cloud-Projekte.
*   **Durchführung:** Es existieren zwei physisch getrennte Apps Script-Projekte (Staging und Produktion). Über CLI-Skripte wird sichergestellt, dass vor jedem Deployment-Befehl dynamisch die korrekte Projektverknüpfung geladen wird, sodass experimenteller Code nur in die Staging-Umgebung gelangt.

## 4. Laufzeit-Schutzmechanismen (Safeguards)

Während der Cloud-Tests muss garantiert sein, dass keine echten Nutzer kontaktiert oder produktive Kalender verändert werden.

*   **Architekturprinzip:** Kapselung von Seiteneffekten (E-Mail- und Kalender-Versand).
*   **Durchführung:** Externe API-Aufrufe erfolgen nie direkt, sondern über zentrale Wrapper-Funktionen. Diese prüfen die aktuelle Umgebung. Im Entwicklungsmodus greifen automatische Interception-Mechanismen, die E-Mails abfangen, an eine Entwickler-Adresse umleiten oder Kalendereinträge nur simulieren. Für zeitgesteuerte Cron-Jobs werden zusätzlich manuelle Trigger bereitgestellt, um den End-to-End-Prozess sofort evaluieren zu können.
