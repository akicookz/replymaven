# Auto-collected metadata

The widget adds browser and device details to each conversation. The dashboard shows this metadata in the conversation details.

| Field | Description |
| --- | --- |
| `browser` | Parsed browser name and version. |
| `os` | Parsed operating system. |
| `device` | `desktop`, `tablet`, or `mobile`. |
| `screenResolution` | Screen width and height. |
| `language` | Browser language, such as `en-US`. |
| `referrer` | Page that linked to the current page, when available. |
| `currentPageUrl` | Page URL when the widget loads. |
| `pageTitle` | Document title when the widget loads. |
| `online` | Whether the browser tab is visible or hidden when collected. |
| `country` | Country from Cloudflare request data, when available. |
| `city` | City from Cloudflare request data, when available. |
| `region` | Region from Cloudflare request data, when available. |
| `timezone` | Time zone from Cloudflare request data, when available. |
| `ip` | IP address detected by the server, when available. |
| `userAgent` | Browser user-agent string from the request header, when present. |

The widget gathers browser and device details. The server adds the location and request fields when Cloudflare provides them. These values can be missing or approximate. Do not use them as verified identity data.
