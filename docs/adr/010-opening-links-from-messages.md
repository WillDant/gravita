# 010 — Opening web links from messages

Status: accepted

## Context
Agents write links in their answers, and a link that can't be clicked has to be copied by hand. Until now the webview had no general way to open a link: `open_sign_in_url` and `open_release_url` each accept one known destination. A link in a message can point anywhere, and its text comes from an agent, whose output a web page or a file it read could influence. A label can also claim one destination and point at another.

## Decision
- **A third command, for the web only.** `open_external_url` (`external_link.rs`) takes `http` and `https` links and hands them to the system's handler, never a shell. `http` stays allowed because agents often link to local dev servers (`http://localhost:5173`).
- **Refuse what disguises a destination.** Credentials in the URL (`https://good.example@evil.example`), whitespace, control characters and backslashes are refused, by the message parser and the opener (`isExternalUrl`) and again by the shell. A refused link stays visible as plain text.
- **The webview never navigates.** The click handler always cancels the anchor's default action, so a message can't replace the app's page.
- **The destination is visible.** The full URL shows on hover. A click opens it directly, with no confirmation, because the browser is the same place the user would paste it and a dialog on every link would soon be dismissed unread.

## Consequences
- A manipulated agent can show a link to a malicious site, and one click opens it in the browser. It gains nothing inside Gravita: no access to the webview, the engine or the filesystem.
- Other schemes (`file:`, `vscode:`, relative file paths) are not links. Opening files an agent mentions would need its own decision.
- A new surface that opens agent-written links should use the same opener rather than `target="_blank"`.
