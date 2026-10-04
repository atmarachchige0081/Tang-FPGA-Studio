# Native AI coding agent

Tang FPGA Studio includes an optional project-scoped AI Assistant powered by the
official Codex App Server. It is an agent rather than a chat-only widget: Codex
can inspect the active project, search RTL and constraints, explain diagnostics,
prepare reviewable patches, run approved commands, inspect the results, and
continue within the same conversation.

## Prerequisite and sign-in

The desktop application discovers `codex` on `PATH` and the official Codex
binary shipped by current OpenAI VS Code extensions. If neither is available,
install the official CLI and restart Studio:

```powershell
npm install -g @openai/codex
codex --version
```

Open **AI Assistant** from the robot icon or press `Ctrl+Shift+A`, select
**Connect agent**, and then choose one of the supported account methods:

- **Sign in with ChatGPT** opens the official OpenAI browser flow.
- **Device code** shows a short code and opens the official verification page.
- **OpenAI API key** passes the key directly to the local Codex process. Studio
  never saves or logs the key. API use is billed separately from ChatGPT.

Authentication and conversation storage are owned by Codex. Studio stores only
non-sensitive panel preferences and the active thread identifier.

## Coding workflow

1. Open the FPGA project and, optionally, select the relevant RTL.
2. Choose a model and thinking level above the message box, or leave the account
   defaults. Refresh the model list after changing accounts. The provider's
   catalog is not an entitlement guarantee; unavailable models can still be
   rejected when a turn starts.
3. Ask a concrete question such as `Find the synthesis error and propose a fix`.
4. Follow the visible activity stream while the agent searches, reads, or runs a
   tool. Current file/cursor, open files, diagnostics, recent tool output, and Git
   status are supplied as bounded, untrusted IDE context.
5. Review command or file-change cards. File changes show paths and the available
   diff before approval. Choose **Allow once**, **Allow session**, **Always
   allow** for guarded file edits, **Reject**, or **Cancel agent**. Generic
   shell commands can only be approved once per request.
6. Click a response reference such as `rtl/top.sv:42` to open that location in
   the existing editor. Press **Stop** at any time to interrupt the turn.

Conversations are scoped to the active project. Changing projects disconnects
the old provider session so project context cannot leak into the new workspace.

## Security model

- The native host canonicalizes the active project and gives Codex one
  workspace-write sandbox rooted at that project. Tool networking is disabled.
- Approval requests are validated again in Rust. Traversal, absolute paths
  outside the project, and symlink escapes are rejected.
- Proposed files are hashed before approval. A patch is rejected if the file
  changed afterward or has unsaved editor content.
- Credential and private-key file changes are blocked. Sensitive open files are
  not added to automatic IDE context, and credential-like protocol data is
  redacted before it reaches UI logs.
- Repository text is marked as untrusted context and never grants permission.
  Destructive commands cannot receive permanent approval.
- SRAM programming and flash remain approval-gated. Flash is persistent and
  should be used only when the user explicitly requests it.

Closing the panel does not discard a conversation. Use **New conversation** to
clear the current panel, **Disconnect local provider** to stop the process, or
**Sign out** to remove the account through Codex.

## Troubleshooting

- **Codex CLI required:** install the official CLI or the official OpenAI VS Code
  extension, then choose **Check again**.
- **Provider stopped:** reconnect from the panel. Pending operations fail instead
  of being reported as successful.
- **Stale file / unsaved changes:** save or discard the editor change, then ask
  the agent to regenerate its patch.
- **Authentication failed:** retry the browser or device flow. Never enter a
  ChatGPT password inside Studio.
- **Build failed:** open Problems or Output, then ask the agent to interpret the
  exact diagnostics. Normal Build/Lint/Simulate controls continue to work while
  the AI panel is closed or idle.

The integration follows OpenAI's documented [Codex App Server](https://developers.openai.com/codex/app-server/)
and [authentication](https://developers.openai.com/codex/auth/) interfaces.
