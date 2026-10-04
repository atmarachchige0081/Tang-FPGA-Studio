# Tang FPGA Studio 3.4.0 — native AI assistant

Studio 3.4 adds an optional project-scoped coding agent powered by the locally
installed Codex App Server. Each user connects their own ChatGPT account or
supplies their own OpenAI API key. No developer account, key, or authentication
file is included in the repository or installer.

The AI panel provides streaming responses, conversation history, project and
editor context, clickable file references, model and supported thinking-level
selection, stop/retry controls, and reviewable file and command approvals. It
can request FPGA workflow actions, but hardware programming remains gated by
explicit approval. A model appearing in the provider catalog does not guarantee
that a particular account can use it; the provider reports access at turn time.

Replies now render emphasis, lists, code, and file references. Tool activity
appears in chronological order and completed work collapses into a compact
summary. Stop can disconnect an unresponsive provider so the panel does not
remain stuck in a running state.

This release also fixes the rejected legacy permission setting, missing spaces
in streamed replies, duplicate execution of an approved FPGA tool request, and
malformed tool requests that previously could leave the agent waiting. Generic
shell commands can only be approved once per request.

The one-file Windows installer now invokes the Tauri production build instead
of compiling a development-mode executable with raw Cargo. It smoke-tests the
copied executable against the bundled workspace before producing an installer,
preventing the previous `127.0.0.1 refused to connect` startup failure from
being published again.

Studio remains usable without AI. See the [AI Assistant guide](AI_ASSISTANT.md)
for sign-in, safety boundaries, and troubleshooting. The separately published
installer continues to guide users through the FPGA toolchain prerequisites.
