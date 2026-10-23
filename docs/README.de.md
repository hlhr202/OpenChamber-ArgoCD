# OpenChamber Argo CD Observer

[English](../README.md) | [简体中文](README.zh-CN.md) | [العربية](README.ar.md) | Deutsch | [Español](README.es.md) | [Français](README.fr.md) | [עברית](README.he.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (Brasil)](README.pt-BR.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [繁體中文](README.zh-TW.md)

Eine **schreibgeschützte Argo-CD-Erweiterung für OpenChamber**. Anwendungen durchsuchen, Deployments prüfen sowie Ressourcenprotokolle und Ereignisse lesen, ohne den Arbeitsbereich zu verlassen.

## Installation

1. In OpenChamber **Einstellungen → Erweiterungen** öffnen.
2. Diese Repository-URL unter **Ordner, ZIP oder URL** einfügen und auf **Hinzufügen** klicken:

   ```text
   https://github.com/hlhr202/OpenChamber-ArgoCD
   ```

3. Die angeforderte Service-Berechtigung prüfen und **Erlauben und aktivieren** wählen.
4. **Argo CD** in der Erweiterungsleiste öffnen und die vorhandenen Kontexte laden.

Weder ein lokaler Build noch eine Installation von Abhängigkeiten ist erforderlich.

Alternativ **openchamber-argocd.zip** aus den [Releases](https://github.com/hlhr202/OpenChamber-ArgoCD/releases/latest) herunterladen und diese ZIP-Datei unter Erweiterungen hinzufügen. Das angehängte vorgefertigte ZIP verwenden, nicht GitHubs **Source code (zip)**.

## Voraussetzungen

- **OpenChamber mit Erweiterungsunterstützung**, eingeführt in [v1.24.0](https://github.com/openchamber/openchamber/releases/tag/v1.24.0). Dieser Build setzt für die Installation derzeit **v2.2.0 oder neuer** voraus; die Kompatibilität mit älteren Versionen ist nicht geprüft.
- **Argo CD CLI installiert und bereits konfiguriert** für den Betriebssystembenutzer, unter dem OpenChamber Server läuft, mit gültigen Zugangsdaten und Leserechten für die benötigten Anwendungen, Ressourcen, Protokolle und Ereignisse. Die Erweiterung liest diese Konfiguration; sie führt die CLI nicht aus und meldet sich nicht separat an.
- OpenChamber Server muss die konfigurierte Argo CD API erreichen können.

## Screenshots

Englische Oberfläche mit Beispieldaten.

**Desktop — Anwendungsliste und Übersicht**

![Argo-CD-Anwendungsliste und Übersicht auf dem Desktop](applications-desktop.png)

**Mobilgerät — Anwendungsliste**

![Argo-CD-Anwendungsliste auf einem Mobilgerät](applications-mobile.png)

## Funktionen

- Argo-CD-Kontexte wechseln und Anwendungen suchen oder filtern.
- Anwendungskonfiguration, Status, Deployment-Verlauf und Ressourcenbäume prüfen.
- Pod-/Container-Protokolle, Ereignisse, Manifeste und Diffs lesen.
- Diagnosezusammenfassungen vorab ansehen und erst nach Bestätigung zum Chat hinzufügen.
- Ausschließlich lesend; Sprache und Design folgen OpenChamber.

## Datenschutz

- Diese Erweiterung erhebt keine personenbezogenen Daten und meldet keine privaten Daten an ihre Entwickler. Sie enthält keine Telemetrie, Analyse oder Nachverfolgung.
- Vorhandene lokale Zugangsdaten werden nur zur Authentifizierung von Anfragen an die konfigurierte Argo CD API gelesen. Zugangsdaten, Anwendungsdaten, Protokolle und Ereignisse werden nicht an Datensammlungsdienste der Entwickler oder Dritter hochgeladen.
- Navigationseinstellungen (Verzeichnis, Kontext, Anwendungs-/Ressourcenkennungen, Anwendungsfilter, Tabs und Layout) werden im OpenChamber-Speicher abgelegt: wenn unterstützt auf diesem Gerät, andernfalls auf dem verbundenen Server. Zugangsdaten, Abfrageergebnisse, Protokoll-/Ereignisinhalte und Zusammenfassungsvorschauen werden dort nicht gespeichert. Wiederhergestellte Auswahlen laden Daten erneut; das fortlaufende Lesen von Protokollen wird nie automatisch fortgesetzt.
- Das Hinzufügen einer Zusammenfassung zum Chat erfordert Ihre ausdrückliche Vorschau und Bestätigung. Wenn Sie sie anschließend senden, verarbeiten OpenChamber und der gewählte Modellanbieter den Inhalt gemäß ihren eigenen Richtlinien.

Diese Erklärung gilt nur für diese Erweiterung, nicht für die Datenverarbeitung von OpenChamber, Argo CD oder Modellanbietern.

## Lizenz

[MIT](../LICENSE). Gebündelte Abhängigkeiten und das Argo-Symbol behalten ihre jeweiligen Lizenzen; siehe [Drittanbieterhinweise](../THIRD_PARTY_NOTICES.txt).
