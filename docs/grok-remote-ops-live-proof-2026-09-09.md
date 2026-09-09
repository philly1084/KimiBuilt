# Remote operations live proof — 2026-09-09

The existing public contract/invocation URLs remain unchanged. Runtime commit `df79ad0b7e64ebb2e0e047766ef10ad00921e4cd` is mounted from immutable ConfigMap `lilly-remote-ops-df79ad0b7e64` over backend image `localhost/lilly-team-release:8e3e42246bcbbd7f` in `kimibuilt/backend`. All seven mounted source hashes matched committed files. The deployment coordinator guarded image/source/resource version; comparison found no unrelated Deployment spec changes. A Recreate rollout briefly delayed backend replacement, then completed successfully.

Focused verification: **8 suites, 242 passing tests**. They cover model/target/workspace continuity, missing-job non-restart behavior, idempotent receipts, concurrent observers and database locking, early task acknowledgment, observer interruption, artifact ownership, mixed-file bundles, and terminal outcome parsing.

## Public authenticated proof

Shared Lilly session: `20abc857-2ecb-4ad2-88a8-0e98c7897d40`.

| Step | Gateway job | Provider/Codex session | Verified result |
|---|---|---|---|
| Primary Astra/high | `ragent_75679f9a2e0c468393d845787b6dd0ad` | `01a08416-f1d4-7670-90d8-a89cff9aa9bb` | Main host `168.119.176.121`, primary domain, 21-file input/output round trip, one 65.003-second build simulation, checkpoint and desktop/mobile proof |
| Feedback Astra/high | `ragent_f0868029f7f542798f3798914f5909e6` | Same primary session | Revised ZIP contains exact heading `Astra feedback round trip`; other 20 source files preserved |
| Secondary Astra/high | `ragent_b86252fb3ac34069bc51e8f90fe43afe` | `01a08426-4948-7412-9caf-908b9e59d4b9` | Domain-only task selected `k3s-secondary`, `/opt/kimibuilt`, host `162.55.163.199` and `demoserver2.buzz`; same shared input bundle read successfully |

Gateway receipts reported `reasoningEffortReceipt.status:applied`, `applied:high`, `appliedTo:cli-invocation` for all three turns. Each used `gpt-6-astra`.

The initial HTTP observation returned while work continued. Separate status requests retained the same job; backend pod replacement did not lose its identity or artifact handoff. Replaying submission IDs returned saved receipts. Running responses exposed bounded progress separately from authoritative completion status. The feedback turn retained its model/workspace/provider session; the secondary run used a fresh provider session and target-specific workspace.

## Durable artifacts

Download through `GET /api/artifacts/{id}/download` with the existing authorized credential.

| Artifact | ID |
|---|---|
| Shared input ZIP | `f7622e2f-b13c-4c83-9b9b-9bf26eb51279` |
| Returned complete website ZIP | `daf93818-3d35-4436-9266-07a961cda137` |
| Primary proof JSON | `595d88c0-38b2-486a-b98c-f02243de3492` |
| Revised website ZIP | `ac187eae-d56b-41be-8863-191d35a5ffd5` |
| Feedback proof JSON | `495ba8f3-aa1b-4fd3-93a2-32d6d62bdb0e` |
| Secondary proof JSON | `fa852feb-7f86-43ef-bcc1-e4cf81913409` |
| Desktop screenshot | `365d42da-d941-4af3-91c2-3e7c7c00e080` |
| Mobile screenshot | `ad8e0f17-47b5-461d-9773-e0519a51e1d6` |

Bulk upload/get verified all 21 input byte sequences, including HTML, CSS, JavaScript, SVG, and PNG. Independently downloading and opening the returned ZIP verified all 21 paths and file hashes against the input ZIP. The revised ZIP was independently opened and its heading checked. Returned desktop/mobile screenshots were visually inspected; the remote browser proof reported no overflow, page errors, or missing displayed assets.

The tiny PNG test input had an existing IDAT CRC defect. Both agents detected/disclosed it and preserved its bytes; Chromium decoded it. The bounded proof therefore demonstrates byte-preserving transfer and honest defect reporting, not an assertion that every input was valid. Some original turn receipts remained `blocked` because they included that warning or requested feedback. The feedback proof also exposed stale questions being parsed from printed checkpoint contents; the final runtime now uses only the latest assistant answer for terminal outcome markers. This fix passed a regression test and was checked against the saved real feedback answer.

## Authentication and deployment boundaries

Anonymous requests, foreign-owner session access, and cross-session artifact reads were rejected. A public endpoint `k3s-deploy` read-only rollout check reached secondary `agent-platform/kimibuilt-remote-runner` and succeeded. Primary direct deployment returned its expected 503 dedicated-credential gate. No secrets were changed. Codex's primary and secondary execution lanes worked; these canaries only inspected cluster state and created isolated proof files, and did not deploy public websites.

The four-hour task lifetime and 30-minute idle limit were read from live gateway configuration; a four-hour load test was not performed. Longer objectives must checkpoint and continue across turns. Completed gateway jobs can become unavailable; durable session receipts, native provider continuity, workspace checkpoints, and downloaded artifacts are the recovery evidence. A missing job is never automatically replaced by the remote-ops status action.
