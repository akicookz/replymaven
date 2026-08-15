---
title: Auto-collected metadata
slug: auto-collected-metadata
excerpt: The device, page, and location data the widget records for every conversation.
---

The widget automatically collects the following metadata for every conversation. It appears in the dashboard conversation detail panel.

| Field | Description |
| --- | --- |
| `browser` | Parsed browser name and version (for example "Chrome 120"). |
| `os` | Parsed operating system (for example "macOS 14", "iOS 17"). |
| `device` | "desktop", "tablet", or "mobile". |
| `screenResolution` | Screen dimensions (for example "1920x1080"). |
| `language` | Browser language (for example "en-US"). |
| `referrer` | The page that linked to the current page. |
| `currentPageUrl` | Full URL of the page where the widget is loaded. |
| `pageTitle` | The document title of the current page. |
| `online` | "active" if the tab is visible, "inactive" if hidden. |
| `country` | Visitor's country, detected server-side via Cloudflare. |
| `city` | Visitor's city (server-side). |
| `timezone` | Visitor's timezone (server-side). |
| `ip` | Visitor's IP address (server-side). |

> [!INFO]
> The first 9 fields are collected client-side by the widget. The last 4 are enriched server-side from Cloudflare request headers.
