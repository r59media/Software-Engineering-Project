# Graphify Knowledge Graph Workflow & Subagent Protocol

This repository maintains a persistent `graphify` knowledge graph in `graphify-out/` (`graph.json`, `GRAPH_REPORT.md`, `graph.html`, `manifest.json`).

## 1. Pre-Edit Graph Discovery (Mandatory First Step)
Before reading, grepping, or modifying files for any feature, bug fix, or architectural question, query `graphify-out/graph.json` first using `graphify-out/.venv/bin/graphify` (or `$(cat graphify-out/.graphify_python)`):
- **Inspect a symbol, route, or D1 table**:
  ```bash
  graphify-out/.venv/bin/graphify explain "<SymbolOrNode>"
  ```
- **Trace cross-stack paths (Frontend <-> Admin <-> Worker <-> D1)**:
  ```bash
  graphify-out/.venv/bin/graphify path "<NodeA>" "<NodeB>"
  ```
- **Query a concept or subsystem**:
  ```bash
  graphify-out/.venv/bin/graphify query "<tokens>"
  ```

## 2. Parallel Subagent Execution
- Delegate independent research and multi-file edits to parallel subagents (`invoke_subagent` with `Model: 'flash'` for fast execution) whenever possible.
- Pass the exact `source_file`, line numbers (`source_location`), and connected neighbor contracts discovered from the `graphify` lookup directly into each subagent's prompt so subagents skip broad repository scanning.

## 3. Post-Edit Incremental Graph Synchronization
- After modifying, adding, or deleting files, keep `graphify-out/graph.json`, `graphify-out/GRAPH_REPORT.md`, and `graphify-out/graph.html` synchronized:
  - A Git `post-commit` hook (`graphify hook status`) is installed in `.git/hooks/post-commit` to automatically re-extract changed code files and rebuild `graph.json` and `GRAPH_REPORT.md` on every `git commit`.
  - When making uncommitted edits or changing documentation/media files (`.md`, `.html`, `.webp`, `.svg`), run the incremental update flow (`detect_incremental` + `build_merge` as defined in the `graphify` skill's `references/update.md`) so the graph stays 100% up to date.
