# OpenChamber Argo CD Observer

English | [简体中文](README.zh-CN.md)

A **read-only Argo CD extension for OpenChamber**. Browse applications, inspect deployments, and read resource logs and events without leaving your workspace.

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
- **Argo CD CLI installed and already configured** for the OS user running OpenChamber Server, with valid credentials and permission to read the required applications, resources, logs, and events. The extension reads this existing configuration; it does not execute the CLI or sign in separately.
- OpenChamber Server must be able to reach the configured Argo CD API.

## Screenshots

English UI with sample data.

**Desktop — application list and overview**

![Argo CD application list and overview on desktop](docs/applications-desktop.png)

**Mobile — application list**

![Argo CD application list on mobile](docs/applications-mobile.png)

## Features

- Switch Argo CD contexts and search or filter applications.
- Inspect application configuration, status, deployment history, and resource trees.
- Read Pod/container logs, events, Manifests, and Diffs.
- Preview troubleshooting summaries and confirm before adding them to chat.
- Read-only by design, following OpenChamber's language and theme.

## Privacy

- This extension does not collect personal information or report private data to its developers. It contains no telemetry, analytics, or tracking.
- Existing local credentials are read only to authenticate requests to your configured Argo CD API. Credentials, application data, logs, and events are not uploaded to developer-operated or third-party collection services.
- Browsing preferences (directory, context, application/resource identifiers, application filters, tabs, and layout) are saved in OpenChamber storage: on this device when supported, otherwise on the connected Server. Credentials, query results, log/event bodies, and summary previews are not saved there. Restoring selections re-queries data; log following never resumes automatically.
- Adding a summary to chat requires your explicit preview and confirmation. If you subsequently send it, OpenChamber and your chosen model provider handle that content under their own policies.

This statement covers this extension, not the data practices of OpenChamber, Argo CD, or model providers.

## License

[MIT](LICENSE). Bundled dependencies and the Argo icon retain their respective licenses; see [third-party notices](THIRD_PARTY_NOTICES.txt).
