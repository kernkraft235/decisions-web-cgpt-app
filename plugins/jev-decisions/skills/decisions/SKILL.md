---
name: decisions
description: Evaluate evidence with JEV Decisions using local or cloud decision models, reusable named questions and sets, and optional interactive workspaces. Use for native probability, choice, and ordered-scale evaluations through JEV tools.
---

Use the JEV Decisions MCP tools for evaluation. Follow the user's explicit provider, model, question definitions, and saving instructions.

- `input` is the evidence being evaluated; question `instructions` describe what to decide about that evidence. Keep those roles separate.
- Prefer the configured server default. `list_models` returns it and the available models. A missing or unavailable model requires an explicit choice; do not silently switch providers or fall back to a cloud API.
- Use `list_library` to find existing definitions. Run a saved set with `setName`, or an ordered selection with `questionNames`. Inline `questions` are useful for one-off evaluations and do not save library definitions.
- When asked to make questions, choose `predicate` for yes/no, `choice` for named alternatives, and `score` for an ordered scale with clear anchors. Write concise, specific instructions and meaningful option/level descriptions. All three types can share one evaluation.
- Save a reusable question or set only when requested, using `save_question` or `save_set`. Set contents are snapshots; updating or deleting a template does not update existing sets.
- Pass chat files through the tools' `files` parameter. Do not transcribe documents, base64-encode a whole document into `input`, or invent download URLs. The server downloads authorized files and converts PDF/DOCX locally.
- Keep the returned workspace UUID. Follow-up tools and linked cards should use it explicitly. Do not assume that one globally active workspace belongs to every chat.
- Reopening a named workspace edits the same workspace. Use `duplicate_workspace` when the user wants an independent copy. `save_workspace` assigns a unique name and protects the workspace from cleanup; its links are for the user's own reachable devices, not public access.
- Before changing or deleting a saved item, retrieve its current ID and revision. Supply `expectedRevision`. On a conflict, retrieve the new state and preserve the user's intended edit rather than blindly retrying an overwrite.
- A request to run authorizes `evaluate`; merely opening a workspace does not. Reuse a `requestId` for a retry of the same run. A `running` response is inspected with `get_run`, not another evaluation. Do not retry a failed/interrupted inference without user intent to run again.
- Report the actual provider/model and returned answers. Probabilities and expected scale positions are model estimates, not independently calibrated facts. Refusals, missing distributions, and failures stay explicit. Do not invent explanatory evidence the decision endpoint did not return.
- Use `render_workspace` when an interactive UI helps. `combined`, `prompt`, `questions`, and `results` views can share the same UUID. The user can change input and press Run directly without another model turn.
- Keep ordinary tool replies concise. `get_run` defaults to summaries; request `detail: full` only when all distributions are needed. `get_workspace` keeps input out of context unless `includeInput` is explicitly needed. When widgets are unavailable, complete the same workflow through tools and readable results.
