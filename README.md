# OpenChamber Argo CD Observer

English | [简体中文](docs/README.zh-CN.md) | [العربية](docs/README.ar.md) | [Deutsch](docs/README.de.md) | [Español](docs/README.es.md) | [Français](docs/README.fr.md) | [עברית](docs/README.he.md) | [日本語](docs/README.ja.md) | [한국어](docs/README.ko.md) | [Nederlands](docs/README.nl.md) | [Polski](docs/README.pl.md) | [Português (Brasil)](docs/README.pt-BR.md) | [Türkçe](docs/README.tr.md) | [Українська](docs/README.uk.md) | [繁體中文](docs/README.zh-TW.md)

A full-featured **Argo CD extension for OpenChamber**. Browse applications, inspect deployments, read resource logs and events, and execute Argo CD operational actions (Sync, Refresh, Terminate, Rollback, Resource Actions, Patch, Create, Delete, and Management operations) directly from your workspace.

## Installation

1. Open **Settings → Extensions** in OpenChamber.
2. Paste the following repository URL into **Folder, ZIP, or URL** and click **Add**:

   ```text
   https://github.com/hlhr202/OpenChamber-ArgoCD
   ```

3. Review the requested Service capability and choose **Allow and enable**.
4. Open **Argo CD** from the extension rail and load your contexts.

No local build or dependency installation is required.

Alternatively, download **openchamber-argocd.zip** from [Releases](https://github.com/hlhr202/OpenChamber-ArgoCD/releases/latest) and add that ZIP in Extensions. Use the attached prebuilt ZIP, not GitHub's **Source code (zip)**.

## Prerequisites

- **OpenChamber with extension support**, introduced in [v1.24.0](https://github.com/openchamber/openchamber/releases/tag/v1.24.0). This build currently declares **v2.2.0 or later** as its installation minimum; older-version compatibility is not verified.
- **Argo CD CLI installed and already configured** for the OS user running OpenChamber Server, with valid credentials and Argo CD RBAC permissions for the required read/write operations. The extension reads this existing configuration and calls Argo CD's official REST API directly; it does not execute the CLI binary or sign in separately.
- OpenChamber Server must be able to reach the configured Argo CD API.

## Screenshots

English UI with sample data.

| Application overview & actions | Sync application dialog |
| :---: | :---: |
| ![Application overview and actions](docs/screenshots/01-applications-overview.png) | ![Sync application dialog](docs/screenshots/02-sync-dialog.png) |
| **Resource tree & resource actions** | **Management (Projects, Clusters, Repositories, ApplicationSets)** |
| ![Resource tree and resource actions](docs/screenshots/03-resource-actions.png) | ![Management view](docs/screenshots/04-management.png) |

## Features

- Switch Argo CD contexts and search or filter applications.
- Inspect application configuration, status, deployment history, and resource trees.
- Read Pod/container logs, events, Manifests, and Diffs.
- Execute Argo CD operational actions (enabled by default, governed by Argo CD RBAC and Sync Windows), modeled after the official [Argo CD CLI](https://github.com/argoproj/argo-cd): Sync (with Prune, Dry-Run, Force, Replace, Server-Side Apply, selective resources), Refresh / Hard Refresh, Terminate Operation, Rollback, Resource Actions (V2 with automatic V1 fallback), Patch, Create/Delete Application & Resource, and ApplicationSet/Project/Repository/Cluster management actions.
- Preview troubleshooting summaries and confirm before adding them to chat.
- Follows OpenChamber's language and theme across 15 locales.

## Privacy

- This extension does not collect personal information or report private data to its developers. It contains no telemetry, analytics, or tracking.
- Existing local credentials are read only to authenticate requests to your configured Argo CD API. Credentials, application data, logs, and events are not uploaded to developer-operated or third-party collection services.
- Browsing preferences (directory, context, application/resource identifiers, application filters, tabs, and layout) are saved in OpenChamber storage: on this device when supported, otherwise on the connected Server. Credentials, query results, log/event bodies, and summary previews are not saved there. Restoring selections re-queries data; log following never resumes automatically.
- Adding a summary to chat requires your explicit preview and confirmation. If you subsequently send it, OpenChamber and your chosen model provider handle that content under their own policies.

This statement covers this extension, not the data practices of OpenChamber, Argo CD, or model providers.

## License

[MIT](LICENSE). Bundled dependencies and the Argo icon retain their respective licenses; see [third-party notices](THIRD_PARTY_NOTICES.txt).
