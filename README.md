# OpenChamber Argo CD Observer

English | [简体中文](README.zh-CN.md)

A **read-only Argo CD extension for OpenChamber**. Browse applications, inspect deployments, and read resource logs and events without leaving your workspace.

## Screenshot

![Argo CD Observer panel in OpenChamber](docs/screenshot.png)

## Features

### Contexts and applications

- Load existing Argo CD CLI contexts, with the current context selected by default.
- Switch contexts to load applications automatically, without changing the CLI's current context.
- Filter applications by name, Project, cluster, application/destination Namespace, repository, Sync, Health, and labels.

### Application configuration and deployments

- Inspect source and destination metadata, including single-source and multi-source configuration overviews.
- Check Sync, Health, Conditions, and the latest operation's status and resource results.
- Browse server-retained deployment history and revision information.
- Read desired Manifests and server-cached Argo Diff results, with sensitive fields hidden.

### Resources and workload details

- Explore a searchable resource tree, filter anomalous resources, and inspect their relationships.
- Select a resource to read its live details and Live Manifest.
- Inspect workload status, Pod readiness, restart counts, and failure reasons.

### Logs and events

- Read Application events and events for the selected resource.
- View Pod/container logs with container selection, time filters, and line limits.
- Start log following explicitly; by default, only a bounded historical fragment is read.

### Read-only access and integration

- Reuse the Argo CD CLI credentials and permissions of the OpenChamber Server's OS user.
- No Sync, rollback, deletion, login, credential renewal, or CLI configuration changes.
- Follow OpenChamber's language and theme, with 15 bundled UI languages.
- Restore project-scoped browsing selections, application filters, tabs, and list layout after panel reloads; switching chats in the same project shares this state.
- Preview and confirm before copying content or adding a summary to chat; no automatic model requests.

## Prerequisites

- **OpenChamber with extension support**, introduced in [v1.24.0](https://github.com/openchamber/openchamber/releases/tag/v1.24.0). This build currently declares **v2.2.0 or later** as its installation minimum; older-version compatibility is not verified.
- **Argo CD CLI installed and already configured** for the OS user running OpenChamber Server, with valid credentials and permission to read the required applications, resources, logs, and events. The extension reads this existing configuration; it does not execute the CLI or sign in separately.
- OpenChamber Server must be able to reach the configured Argo CD API.

## Installation

1. Open **Settings → Extensions** in OpenChamber.
2. Paste the following repository URL into **Folder, ZIP, or URL** and click **Add**:

   ```text
   https://github.com/hlhr202/OpenChamber-ArgoCD
   ```

3. Review the requested Service capability and choose **Allow and enable**.
4. Open **Argo CD** from the extension rail and load your contexts.

No local build or dependency installation is required.

## Privacy

- This extension does not collect personal information or report private data to its developers. It contains no telemetry, analytics, or tracking.
- Existing local credentials are read only to authenticate requests to your configured Argo CD API. Credentials, application data, logs, and events are not uploaded to developer-operated or third-party collection services.
- Browsing preferences (directory, context, application/resource identifiers, application filters, tabs, and layout) are saved in OpenChamber storage: on this device when supported, otherwise on the connected Server. Credentials, query results, log/event bodies, and summary previews are not saved there. Restoring selections re-queries data; log following never resumes automatically.
- Adding a summary to chat requires your explicit preview and confirmation. If you subsequently send it, OpenChamber and your chosen model provider handle that content under their own policies.

This statement covers this extension, not the data practices of OpenChamber, Argo CD, or model providers.

## License

[MIT](LICENSE). Bundled dependencies and the Argo icon retain their respective licenses; see [third-party notices](THIRD_PARTY_NOTICES.txt).
