# Documentation for AI agents

Use this index to find the repository's working rules and implementation references. The linked source documents remain authoritative; this index avoids maintaining duplicate copies that can drift.

## Before changing code

1. Read the root [`AGENTS.md`](../../AGENTS.md) and the scoped `AGENTS.md` for the area being changed.
2. Inspect the worktree and preserve all pre-existing edits.
3. Read the [testing strategy](../development/testing-strategy.md) and [implementation plan](../development/implementation-plan.md), then read only the relevant architecture and feature documents below.
4. Review the latest [change log entries](../change-logs/README.md).
5. Identify scope, risks, affected files, relevant checks, and rollback before editing.

## Working references

- [Product requirements and implementation boundary](../prd/packetmotion-fabric-v1.1.md)
- [Implementation plan and milestones](../development/implementation-plan.md)
- [Risk-based testing strategy](../development/testing-strategy.md)
- [Controller UI component conventions](../development/ui-component-architecture.md)
- [Architecture and security index](../README.md)
- [Current delivery status](../STATUS.md)
- [Debian bootstrap and interface-name-preserving networking](../../sdwan-edge/sdwan-provisioning-scripts/README.md)
- [Management communication and recovery](../operations/management-channel.md)
- [Edge and Hub agent installation](../operations/agent-installation.md)
- [Runtime error capture and troubleshooting](../operations/runtime-error-troubleshooting.md)
- [API contract](../../api/openapi.yaml)
- [Controller-specific rules](../../sdwan-controller/AGENTS.md)
- [Go agent-specific rules](../../sdwan-edge/AGENTS.md)

## Documentation maintenance

Update a source document when a code change makes its documented behavior, contract, setup, security, recovery, or verification guidance inaccurate or incomplete. Update the [human documentation index](../human/README.md) or this index when adding, moving, or renaming source documents. A change log entry is required for every meaningful task, even when no other documentation needs a content update.
