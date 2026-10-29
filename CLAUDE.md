# PacketMotion Fabric — Claude Code

Shared rules live in AGENTS.md (single source of truth for all agents):

@AGENTS.md

## Scoped rules
- Before editing under `sdwan-controller/` or `sdwan-edge/`, read that directory's `AGENTS.md`; they are not auto-loaded.
- On release/feature status, the root `AGENTS.md` and `docs/STATUS.md` win over older wording in scoped files.

## Stack and commands (quick reference)
- Controller: Next.js (non-standard version — check `node_modules/next/dist/docs/`), TypeScript, Tailwind 4, shadcn/ui, Lucide, Biome, PostgreSQL. Run from `sdwan-controller/`:
  `npm test` · `npm run test:integration` · `npm run test:browser` · `npm run test:visual` · `npm run test:agent` · `npm run lint` · `npm run typecheck` · `npm run build`
- Agent: Go 1.27.2 in `sdwan-edge/`: `go test ./...` · `go test -race ./...` · `go vet ./...` · `go build ./cmd/fabric-agent`
- Change log: `node scripts/append-change-log.mjs <entry-file>` from repo root (locked writer; never edit logs by hand).
- API contract: `api/openapi.yaml` (large — grep for the path/schema, don't read whole).

## Command policy (token use)
- When `rtk` is on PATH, prefix git, test, build and lint commands with it: `rtk git status`, `rtk git diff`, `rtk npm test`, `rtk go test ./...`.
- Use raw output only when rtk hides detail needed for debugging (failing test bodies, stack traces, exact diffs).
- Prefer bounded output: `head`, `tail`, `grep -n`, `git diff --stat` before full diffs.

## Navigation policy
1. Symbol/concept search first: claude-context MCP when registered; otherwise Grep/Glob.
2. Then read only the specific file ranges (Read with offset/limit), not whole files.
3. `.claude/codebase-structure.xml` (repomix, signatures only, ~35k tokens) is for orientation on demand — grep it or read ranges; never `@import` it. Regenerate with `npx repomix` when stale.
4. Excluded from that snapshot (read on demand): `docs/`, tests, migrations, shell installers, `api/openapi.yaml`, release assets.
5. Do not read `docs/change-logs/` beyond the latest few entries (`tail`).

## Output policy
- Be concise. Don't restate the task or paste/recap diffs.
- The AGENTS.md post-change report is still required, but as terse bullets: status, changed files, tests actually run (with results), UI/network impact, risks, rollback, log path, next step. Omit items that are "none" in one line.
