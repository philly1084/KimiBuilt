# Remote operations polling and cancellation verification

Verified on primary Lilly, 2026-09-09, at runtime source `666908033f8389907f34dc336eabdc7ebff7874f`.

- Public API contract revision 3; 257 tests passed across 11 focused suites.
- Immutable runtime configuration `lilly-remote-ops-666908033f83`; all 12 mounted source hashes matched the release. Preserved backend image `localhost/lilly-team-release:8e3e42246bcbbd7f` and unrelated deployment specification.
- Rollout initially stalled after old backend removal. A coordinator-guarded deployment metadata annotation triggered reconciliation; rollout then completed successfully.
- Real Astra canary: Lilly session `5d48d0ec-a33a-4531-848e-d8cdff16340c`, gateway job `ragent_903e6dd05f274b1fa4f41eab8016710f`. Cancellation returned `terminated` during an active observation; repeated cancellation returned its saved receipt.
- Concurrent observation returned 409 and `Retry-After: 30`. Persisted status throttling returned 429 and `Retry-After: 30`; rejected polls did not increment the gateway observation count. Terminal status was cached.
- Shared artifact `c6518217-454a-497c-a438-7deed3607062` was read back byte-for-byte after cancellation. Temporary input manifest remained at `/opt/lilly-agent-workbench/.kimibuilt/agent-runs/46a968db-f781-4bd8-9f06-392ea67e7f60/input/manifest.json`.

This proves the bounded canary behavior, not the cause of the earlier reported data loss or recovery of that data. Temporary handoff retention still applies. Request/concurrency admission is per backend replica; the per-job polling budget is persisted under the existing session advisory lock.

See [the bot integration guide](grok-remote-ops-api.md#polling-limits-and-cancellation-revision-3) for limits and cancellation requests.
