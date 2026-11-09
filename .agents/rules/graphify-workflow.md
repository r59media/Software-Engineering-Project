# Graphify Knowledge Graph Workflow & Dispatch Protocol

This repository maintains a persistent `graphify` knowledge graph in `graphify-out/` (`graph.json`, `GRAPH_REPORT.md`, `graph.html`, `manifest.json`). All development and maintenance tasks follow the **Cheapest 1-Main-Agent-Dispatch Configuration**.

---

## 1. Architecture: 1-Main-Agent-Dispatch

```
Me (Main Agent) -> Builder Subagent (Gemini Flash High Effort, Model: 'flash') -> Me (Main Agent)
```

- **Main Agent**: Deconstructs requirements, prepares explicit pseudo-code and contracts, selects target symbols, and launches the Builder Subagent via `invoke_subagent` with `Model: 'flash'`.
- **Builder Subagent**: Runs with high effort to execute AST lookups, perform surgical edits, run typechecks/builds, synchronize the graph via `graph-assist.py`, and report back via `send_message`.

---

## 2. Builder Subagent Workflow Lifecycle

Inside the Builder Subagent, execution strictly follows three deterministic steps:

### Step 1: AST Lookup First (<200ms) — Zero Blind Repo Scanning
Never grep or scan the entire repository blindly. Query the AST coordinates directly via `graph-assist.py`:
- **Explain symbol or fallback to query**:
  ```bash
  python3 graph-assist.py lookup "<SymbolOrQuery>"
  ```
- **Find path between two symbols**:
  ```bash
  python3 graph-assist.py path "<SourceSymbol>" "<TargetSymbol>"
  ```

### Step 2: Surgical Edits & Verification
- Read only the target line ranges identified by `graph-assist.py`.
- Apply precise edits adhering to the spec while preserving existing comments, documentation, and code style.
- Run project verifications:
  ```bash
  pnpm --dir frontend run check
  pnpm --dir backend run typecheck
  pnpm --dir backend run build
  ```

### Step 3: Graph Synchronization
Keep `graphify-out/graph.json` and `GRAPH_REPORT.md` synchronized after making code changes:
- Run incremental update via CLI:
  ```bash
  python3 graph-assist.py update [files...]
  ```
  *(If omitted, `graph-assist.py` automatically detects modified/untracked files from git).*
- Alternatively, if a `graphify-maintainer` subagent conversation ID is active, peer-message the modified file list via `send_message`.

---

## 3. Git Hooks & Continuous Sync
- A Git `post-commit` hook is installed in `.git/hooks/post-commit` to rebuild `graph.json` and `GRAPH_REPORT.md` upon every `git commit`.
- When changes occur outside commits (uncommitted work or staging), `python3 graph-assist.py update` guarantees zero graph drift.
