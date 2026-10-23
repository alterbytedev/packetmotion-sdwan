# Documentation for people

This index groups the product and operational material for operators, reviewers, and contributors. The linked documents are the authoritative sources; implementation checklists for AI agents are collected in [`docs/agent`](../agent/README.md).

## Product and delivery

- [Interface, VLAN and advertisement implementation plan](../development/interface-vlan-management-plan.md)
- [Interface configuration, safe commits and activation gates](../operations/interface-management.md)
- [Product requirements](../prd/packetmotion-fabric-v1.1.md)
- [Current delivery status and verification limits](../STATUS.md)
- [Implementation milestones](../development/implementation-plan.md)
- [FRR configuration management plan](../development/frr-configuration-management-plan.md)

## Architecture and security

- [Architecture overview](../README.md)
- [Network design](../architecture/network-design.md)
- [Agent control-channel target](../architecture/agent-control-channel.md)
- [Security model](../architecture/security-model.md)
- [Architecture decisions](../adr/README.md)
- [WireGuard draft and explicit deployment decision](../adr/0006-wireguard-draft-publication.md)
- [Next.js controller and Go agents decision](../adr/0001-nextjs-controller-go-agents.md)
- [Agent management channel decision](../adr/0002-agent-management-channel.md)

## Operations and development

- [Debian bootstrap and interface-name-preserving networking](../../sdwan-edge/sdwan-provisioning-scripts/README.md)
- [Routed LAN delivery and activation](../operations/routed-lan.md)
- [Selected hub WireGuard tunnels and local activation](../operations/wireguard-tunnels.md)
- [Management communication and recovery](../operations/management-channel.md)
- [Edge and Hub agent installation](../operations/agent-installation.md)
- [TCP/UDP network communication matrix](../operations/communication-matrix.md)
- [Runtime error troubleshooting](../operations/runtime-error-troubleshooting.md)
- [Codebase map and maintenance guide](../development/codebase-map.md)
- [Testing strategy](../development/testing-strategy.md)
- [Controller-agent communication reliability plan](../development/controller-agent-communication-plan.md)
- [Controller UI component architecture](../development/ui-component-architecture.md)
- [Controller development guide](../../sdwan-controller/README.md)
- [Go agent guide](../../sdwan-edge/README.md)
- [HTTPS/mTLS ingress guide](../../deploy/proxy/README.md)

## Evidence and history

- [Verification evidence and limitations](../evidence/README.md)
- [Append-only change log](../change-logs/README.md)
