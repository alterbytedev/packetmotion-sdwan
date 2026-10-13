# Agent Change Logs

- Active file: `log_change_001.md`
- Rotation threshold: 500 KiB (512000 bytes).
- Numbering: `log_change_001.md`, `log_change_002.md`, etc., never reuse or overwrite.
- Append after each meaningful change; use file locking or equivalent serialization when multiple agents write.
- Each entry: change ID, timestamp, agent, milestone, status, summary, reason, files, test commands and real results, UI/network impact, risks, rollback.
- Do not include secrets. Commit logs to Git. These are not runtime logs.
- Update this index when rotating; archive old files without deletion.

## Writer
Run `node scripts/append-change-log.mjs <entry-file>` from repository root. Requires Python 3 and local POSIX flock (macOS/Linux). The persistent ignored `.append.lock` inode must not be deleted during active writes. Whole-entry size is limited; oversized records must be split. Run `node --test tests/change-log.test.mjs` to verify concurrency, rotation and lock release after SIGKILL. This does not prove partial-write recovery during disk failure or safety on network filesystems.
