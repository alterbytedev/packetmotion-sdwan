# Verification evidence

## Interface discovery and inactive drafts — 2026-10-22

The subsequent interface-row correction replaces the standalone draft panel with Configure/VLANs actions and the existing modal. Targeted desktop/mobile tests passed selected-parent locking, physical WAN DHCP save, VLAN save with preservation of the other interface, saved-value reload, keyboard focus restoration, viewer denial and viewport bounds. Screenshots were reviewed locally but are not stored in Git. The earlier interface-drafts captures show the superseded layout and are also kept out of Git. Current-IP telemetry and agent apply/rollback remain outside this UI correction.

The [Hub inspection](interface-inspection/hub-2026-10-22.json) was collected with a temporary source CLI build on user-specified 192.168.160.142; it proves read-only discovery only. The [delivery guide](../operations/interface-management.md) records versions, ownership observations and pending trunk/console prerequisites. Targeted browser tests passed desktop/mobile draft persistence and viewer denial; reviewed [desktop](browser/interface-drafts/desktop.png) and [mobile](browser/interface-drafts/mobile.png) screenshots are synthetic UI evidence. Agent deployment, VLAN creation, safe-commit rollback, BGP advertisement and forwarding are not established by these results.

Browser screenshots and runtime traces produced by Playwright, including `npm run test:baseline`, are written under the ignored `sdwan-controller/test-results/` directory. They are not committed. Record verification results in text and use synthetic test identities; never capture credentials. The desktop and mobile baseline viewports are 1440x1000 and 390x844.

Existing M0 originals under browser/baseline/ remain historical tracked assets. New captures stay local. Compare the preserved login and dashboard shell; intentional inventory content changes are assessed separately. Screenshot capture alone is not a pixel comparison or release approval.

Network evidence is not available at M0/M1. Rama will supply the local VM lab later.

M1 actual inventory screenshots: browser/inventory-desktop.png and browser/inventory-mobile.png. The current requested inventory uses a horizontally scrollable table on mobile, with server pagination/search and no page-level overflow. `npm run test:visual` compares four protected login/header regions pixel-for-pixel using pinned pngjs; comparison metadata is in browser/protected-region-comparison.json. It excludes the development overlay and intentional inventory changes and requires the same local OS/browser/fonts. No network or cross-platform rendering outcome is inferred.

Device-flow refinement: the operator adds Edge/Hub directly. The overview introduction was intentionally reworded for terminology consistency, so the protected visual check compares navigation header chrome (72px), not editable page introduction copy. Original M0 images remain intact.

Devices consolidation evidence: browser/device-detail-desktop.png and device-detail-mobile.png show scoped configuration and telemetry within the existing dashboard. Browser tests cover 31 devices across multiple pages, server search, page-size changes, stale-response cancellation, API failure/retry, admin publishing and viewer API denial. These are functional checks, not a production-scale benchmark. Dashboard browser coverage now uses folder routes for inventory and scoped device details.

UI consistency audit: desktop/mobile form, navigation, inventory and device-detail renders were reviewed locally; screenshots are excluded from Git. The four protected regions have zero changed pixels. Content review is not a full pixel comparison. Local Chromium keyboard/ARIA checks and stubbed clipboard outcomes do not prove screen-reader speech, OS clipboard permissions or cross-browser rendering. See [component architecture](../development/ui-component-architecture.md) and the change log for exact results.

Selected hub WireGuard source 0.2.0 has real namespace handshake/tunnel-ping, rollback/recovery and positive/negative forwarding-isolation evidence, plus user-provided Debian Hub/Edge lab activation. See [operations](../operations/wireguard-tunnels.md), [ADR 0004](../adr/0004-wireguard-adjacencies.md) and exact commands/results in the append-only task log. This does not prove general LAN routing, BGP/failover, NAT, MTU behavior or fleet capacity.

Task screenshots for saved hub selection were reviewed locally and are not included in Git. Existing browser snapshots were restored after legacy specs rewrote them. Content inspection and overflow assertions are not a full pixel regression. Supplied Debian Edge/Hub reboot, mTLS applied/handshake status and controller-disconnection restoration also passed; exact limits and any failed/aborted test attempts are recorded in the task log.

## Reusable sizing and inventory table — 2026-10-20

Desktop/mobile inventory, loading/empty states, settings, device connections/configuration and modal captures were visually reviewed locally. Eight targeted Chromium browser journeys passed under Xvfb with a dedicated ignored test build directory; the default local cache and headless rendering were unsuitable in this environment. Test-generated legacy screenshots were restored; M0 originals were not overwritten.

The legacy `test:visual` fixtures have incompatible viewport dimensions for this environment. A fresh capture of the task-start tracked source was compared on the same Chromium/viewport: desktop login and both navigation headers had zero changed pixels; mobile login differed in 13 border/shadow pixels, each by at most one RGB level, with matching layout. This is a scoped comparison and visual review, not a passing legacy exact-pixel suite or cross-browser guarantee. See [component usage and extension](../development/ui-component-architecture.md) and `UI-COMPONENTS-TABLE-034` in the change log. No networking outcome is inferred.

## WireGuard explicit deployment — 2026-10-20

Synthetic controller/browser fixtures exercised saved-draft persistence, local activation requirements and matching applied configuration. Screenshots were reviewed locally and are excluded from Git. Four targeted Chromium/Xvfb browser journeys passed: draft persistence without publication, atomic peer publication, disabled/received/applied status, copy report, multi-Hub setup and viewer denial. Observation records were inserted only into disposable test databases; these checks are UI evidence, not real WireGuard handshakes or appliance connectivity. The new draft integration scenarios and existing controller suite pass (30 tests). See [workflow](../operations/wireguard-tunnels.md#draft-and-explicit-deployment-workflow) and ADR0006; real Edge/Hub apply remains subject to local activation and separate lab verification.

### Conditional WireGuard activation tips

The fixture-backed Connections view shows the local-command tip for current
disabled observations and hides it when applied/recent-handshake observations
arrive. Captured by the targeted WireGuard deployment browser journey and
visually reviewed locally. These are synthetic observations, not a live Debian
activation or connectivity result; screenshots are excluded from Git.


## Device detail categories — 2026-10-20

The five device categories were captured and visually reviewed locally at 1440px desktop and 390px mobile, with tab wrapping and no page-width overflow. Screenshots are excluded from Git. Overview/Underlay telemetry is synthetic; these captures do not prove an appliance check-in, Internet connectivity, WireGuard apply, BGP sessions or routed reachability. Existing screenshot baselines remain unchanged.

Fourteen targeted Chromium/Xvfb journeys passed across focused runs: category/keyboard navigation, preserved form edits, telemetry refresh failure/retry, rename/archive, device-scoped configuration publication and viewer denial, superadmin disclosures/raw history/current-state collection and live-role denial, management troubleshooting, the local-only preview modal, and both saved WireGuard/deployment workflows. Headless Chromium frame callbacks failed in this environment; final browser evidence uses headed Chromium under Xvfb and fresh ignored test build directories. This is visual inspection plus interaction/overflow coverage, not a passing full pixel-diff or cross-browser suite.

## Interface safe commit increment — 2026-10-22

Agent 0.4.0 adds current interface CIDRs and dedicated static LAN/VLAN safe apply through a locally authorized independent guard. Controller migrations 0022/0023 add candidates and immutable commit history; Underlay row actions offer Save and apply and Edit and retry. WAN/DHCP/gateway/advertisements remain blocked by this adapter, and forwarding stays isolated. Earlier metadata-only descriptions above describe the previous increment. See [interface operations](../operations/interface-management.md) for ownership, activation, recovery and evidence limits.

- [Interface safe commit namespace and browser evidence](interface-apply/README.md).
