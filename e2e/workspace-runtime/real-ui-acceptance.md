# Workspace Runtime: independent real UI acceptance

Latest exercised candidate: `0ec7bce9` (heterogeneous event ownership `17dfb594`, desktop proxy `73abbcdc`) (Electron cancellation `8f716753`, earlier scan/project/exit-code `75a347e5`). Local core journeys have passed the explicit retests below. Heterogeneous required-project selection, actual Codex pwd and reopened result are **PASS** after local CLI build. There is no unresolved failure in the exercised local main branches. Both test-server stages are **NOT RUN**. Historical failures are retained and superseded only by explicit retests.

## Current consolidated status — 2026-09-06 01:34

| Scope | Current result | Evidence / limit |
| --- | --- | --- |
| Web new-topic structure, grouping, old/plain/project/scratch history | PASS | Actual Chrome clicks; no local/project picker; disabled unconfigured cloud and online Gateway retained. Original desktop project executes on captured BIELNB4284. |
| Web Gateway approval, refusal, real stdout/final, natural finish | PASS | Fresh pwd tpc_Mu5fcttBBzZu; denial tpc_pRqeLZXM1MK2. |
| Web original project and root/wrapped ZIP execution | PASS | Actual activation, reference and script output; bound A roots/env; project→ZIP→wrapped→project reactivation and offline recovery. |
| Electron top-new A inheritance unchanged and A→B, first-send placement/defaults | PASS | A unchanged tpc_Hd1FOV3pl0d4, changed B tpc_6xZHAT7qWq0q; original A unaffected. |
| Pure chat / scratch first success, repeat, visible retry / first false→pwd | PASS | Pure chat creates none; one successful scratch reused; failed false unbound until same-topic pwd. |
| Cancellation delayed binding | PASS for exercised branches | Electron actual foreground Stop→42s/reopen unbound→pwd binds; Web Stop→35s/reopen plus Electron history unbound. Web wait-window output is not a final process-success proof. |
| Absolute read and permissions | PASS for main cases | Home direct-only read no scratch; /tmp once-only approval actual marker; separate denial→permitted home follow-up. |
| Settings drafts / project skills / env roots / ZIP cache | PASS | All three sections collapsed preserve drafts; real skill discovery/activation/reference/script; A env and managed precedence, root/wrapped cache roots. |
| Scan failure / retry | PASS | Scoped fixture EACCES visible in settings and chat; permissions restored; real Retry discovers and activates marker. |
| Device offline / recovery | PARTIAL PASS | Actual device list empty, model stops without fallback; restored original A executes. Direct offline pwd backend rejection not reached because model stopped first. |
| Heterogeneous unbound project recovery action / real execution | PASS on available machine | Real added Codex selects A; after proxy/owner/CLI repairs, actual pwd stdout and final A; same result persists on reopen. Second-device and historical heterogeneous scratch fixtures unavailable. |
| Web upload | BLOCKED | Browser extension setFiles Not allowed. No alternate upload path used; Electron own ZIP uploader passed separately. |
| Legacy half-migrated / second-device / exact fault timing | BLOCKED | No genuine fixture or reliable UI-only post-success/pre-finalize window; no injected application state. |
| Test-server Web then Electron | NOT RUN | Await parent release after local acceptance/type/CI. |

A main-case PASS does not pass extra matrix rows. Exact supplemental branches below retain their own status.

## Local Web results — 2026-09-05

All actions below used the actual Chrome product tab, clicking and typing. Evidence directory: `/tmp/masterino-independent-acceptance-20260905/`.

| Case                                 | Result                                         | Actual evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W01 target/new-topic UI              | PASS                                           | Top new-topic action opened a draft; menu offers no-device, disabled cloud sandbox (server unconfigured), and online BIELNB4284. No local-machine item or directory picker. `web-target-menu.png`.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| W01 grouping UI                      | PASS                                           | Sidebar grouping menu contains status/time/flat, no project mode. Switched to flat and restored time grouping; all topics remained. `web-group-menu.png`.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| W02 known history                    | PARTIAL                                        | Both supplied old topics opened their original transcripts: `tpc_YKFFpbGhgBEj` and `tpc_qPwKcb1wkDo0`. Neither is a directory/device fixture. Desktop project history subsequently PASS: Electron-created `tpc_X0Ner9dRF01G` appears in Web history, opens the original prompt/tool transcript, and displays bound device BIELNB4284. `web-desktop-project-history-visible.png`. Scratch history remains NOT RUN.                                                                                                                                                                                                    |
| New plain chat                       | PASS for response; reasoning UI initially FAIL | New `tpc_UJRbgLSeqSNM` received actual response `独立Web聊天成功`. It persisted in the sidebar. Reasoning spinner stayed `深度思考中…` beyond two minutes, including navigation away/back. `web-chat-success.png`, `web-thinking-pending-after-response.png`. Retested after reload with the supplied StreamingHandler fix: new `tpc_imoqRT28cWHk` returned `思考状态验收完成` and visibly closed reasoning as `已深度思考（用时 0.2 秒）`. Retest PASS; `web-reasoning-retest-pass.png`. Its generated sidebar title was `Web思考状态验收未按指示完成`, although the response correctly matched the requested text. |
| Attachment menu                      | PASS for menu/chooser; actual upload BLOCKED   | Visible attachment menu opened the file chooser. Uploading synthetic `web-attachment.txt` failed at browser extension `fileChooser.setFiles` with `Not allowed`. Required “Allow access to file URLs” instruction was reported; no alternate upload bypass used.                                                                                                                                                                                                                                                                                                                                                     |
| Web device-settings affordance       | PARTIAL                                        | Home account → application settings has no Devices sidebar entry. No device-directory controls visible. A device detail page has not been reached via UI, so its contents are NOT RUN. `web-settings-navigation.png`.                                                                                                                                                                                                                                                                                                                                                                                                |
| Web Gateway new-topic execution      | FAIL                                           | Confirmed BIELNB4284 online, selected it before first send, requested actual `pwd`. In new `tpc_zIPWyqWfKRoC`, model requests activation of `lobe-cloud-sandbox`; expanded parameters confirm that identifier. Cloud activation was never approved, so no actual cloud fallback execution is claimed. Parent confirmed native Web runner routing defect and is fixing it. `web-gateway-offers-cloud-tool.png`.                                                                                                                                                                                                       |
| W03 existing bound-project execution | NOT RUN                                        | The supplied historical topics are plain-chat fixtures. Create a project fixture through Electron later, then revisit Web.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Gateway failure reproduction: open agent `agt_LE7oduETjZ4x` → new topic → execution menu → online BIELNB4284 → send `独立 Web Gateway 验收 WEB-GATEWAY-20260905：请实际调用命令工具，仅执行 pwd，返回原始输出。不要凭上下文猜测，不要调用其他工具。` → observe cloud-sandbox activation approval at `http://localhost:3010/agent/agt_LE7oduETjZ4x/tpc_zIPWyqWfKRoC`. A feedback attempt was obscured by the development performance panel and did not advance; this is not recorded as an independent approval-handler defect. Retest must use a fresh topic after the routing fix.

Earlier environment interruptions: `/__local-dev` initially displayed `ERR_BLOCKED_BY_CLIENT` (`web-entry-blocked.png`), followed by read timeouts. At 18:53 the existing agent page showed HTTP 500 (`web-existing-http500-1853.png`). After the parent explicitly authorized refresh and restored services, the same tab loaded the product. A local Vite restart interrupted one navigation; that navigation was repeated, not counted as passed from the interrupted attempt.

## Local Electron results — 2026-09-05

Environment switch: after the runnable local Web first pass, the parent explicitly authorized Electron acceptance to create cross-surface fixtures while repairing Web Gateway. HEAD was `d02931c2`; renderer files continue to change during repair. The running development app is `/Users/a10507479/Desktop/codes/Masterino/apps/desktop/node_modules/.pnpm/electron@41.3.0/node_modules/electron/dist/Electron.app`. It shows local developer and the same historical Web topics. A generic Electron lookup resolved an unrelated default application, so testing uses the exact repository app path.

| Case                                    | Result                     | Actual evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E02 initial desktop defaults            | PARTIAL PASS               | Agent new topic defaults to 本机; 项目 and 最近 groups and their plus controls are visible.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Project + existing semantics            | PASS for selection/lock    | Clicked project plus and selected synthetic project A with the native folder picker. This existing entry locks the project immediately, as explicitly required by the user and clarified by parent. It is **not** a first-send-lock defect. `electron-project-created-before-send.png`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Top new-topic draft                     | PARTIAL PASS               | Top new-topic action exposed editable local target and project selector; selected previously created project A. Full inheritance from a sent A topic and switching to B remain NOT RUN.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| First project message/default expansion | PASS for visible placement | Sent the project-skill probe through actual composer. New topic `tpc_X0Ner9dRF01G` appears in automatically expanded project-a group; target/path become locked after first send.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| S02 discover/activate/reference         | PARTIAL PASS               | Without opening project settings, the chat performed Project Skill activation for acceptance-probe, file glob, and readReference for references/probe.md. The unique project reference marker appeared in the tool-driven flow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| S02 script / S04 roots                  | IN PROGRESS, interrupted   | Tool approval parameters show `sh /private/tmp/masterino-independent-acceptance-20260905/project-a/.agents/skills/acceptance-probe/scripts/probe.sh`. Approved through actual UI after opening the right panel to expose Submit (development toolbar covered it). After a parent-confirmed HMR/Next restart interruption, the same topic recovered. Expanded execScript returned `A canonical workspace-local skill directory is required for device execution.` No successful cwd/env output. The earlier activation/glob/reference calls show green success. The transient loading screenshot is `electron-after-skill-submit.png`; another screenshot attempt coincided with another reload, so the exact error is supported by the visible AX transcript, not that screenshot. Parent notified for repair. |

Native Computer Use `type_text` dropped Chinese characters in the first unsent draft. The draft was replaced with a complete English equivalent and verified before send; the partial Chinese text was never submitted. Some native picker actions required re-reading state and selecting the exact project-a entry. No unrelated file was opened or uploaded.

Web re-entry: parent authorized returning from Electron to local Web after reading the original skill result, to retest repaired Gateway routing and the desktop-created project fixture. Refreshed the existing Web tab on `d02931c2` plus uncommitted Gateway changes; both surfaces were loading during another shared update. Product loaded and the desktop project history was opened successfully. Parent then requested a pause for one shared-module fix: project skill activation state lacked the ID required by activation-history selection. After the stable-window notice, created fresh Gateway topic `tpc_9WPaB95IfXmW`, selected online BIELNB4284, and requested only actual pwd. It showed server-running status for about one minute, then stopped with an entirely empty assistant message: no tool, approval, output, or visible error. This retest FAIL was reported; `web-gateway-retest-empty-response.png`. No refresh or stop occurred during that run. Returned to Electron original project A and sent the explicitly authorized harmless skill-script retry at UI 19:35:53; result pending.

## Scope and execution order

Run the complete product UI in this order: local Web → local Electron → test-server Web → test-server Electron. Record the candidate commit and working-tree diff for every environment. A stage that has not run is **NOT RUN**, never inferred from another stage. Report every reproduced failure immediately with the smallest click sequence, actual/expected results, and screenshot or visible transcript.

Local Web entry: `http://localhost:3010/__local-dev` (proxy 3010, Next 3011, Vite 9876). Local Electron uses `scripts/local-dev/cli.mts desktop` and frontend 5173. The test-server launch entry is `scripts/local-dev/cli.mts desktop-test`, targeting `https://mlai-test.bielcrystal.com`. Do not restart or replace existing processes without coordinating with the main agent. Do not deploy during acceptance.

Use Browser for Web; use Computer Use for the running Electron product. Read their skills before first use. A browser-rendered Electron frontend is not proof of Electron IPC or device execution. Existing `e2e/electron/workspace-runtime.spec.ts` is an additional focused integration suite: its production component harness and injected transport do not substitute for these user journeys.

Actions must be visible clicks, typing, file selection, and keyboard navigation. No store mutation, private page state, API sends, injected IPC calls, request mocks, or business-code changes. Read-only filesystem/database checks may supplement a UI journey when UI cannot prove absence or uniqueness of a scratch directory; label those separately. Do not read browser cookies, storage, profiles, or `.local-dev/config.env`; never output private keys. Use only synthetic test data.

## Fixtures to prepare before each stage

Prepared local synthetic files under `/tmp/masterino-independent-acceptance-20260905/`: `project-a`, `project-b`, `absolute-read-probe.txt`, `acceptance-root.zip`, `acceptance-wrapped.zip`. Project A contains `.agents/skills/acceptance-probe`, a unique reference marker, harmless script, root `.env`, configured-env candidate `acceptance.env`, and skill-local `.env` decoys. Projects A and B were selected through native Electron UI and produced real execution fixtures. Both root and wrapped synthetic ZIPs were imported through Electron UI; actual local and Web device results are recorded below. Skills print only cwd, WORKSPACE_DIR and named synthetic ACCEPTANCE values.

- Two independent projects A and B on the bound device; a harmless marker file in each distinguishes cwd. Use a unique `acceptance-YYYYMMDD-HHMM` namespace.
- A legacy topic with a directory binding, a project topic already bound to another device, a pure-chat topic, a scratch topic, and a gateway-only/unbound topic. Obtain them through supported product UI; do not fake binding state to turn an unavailable setup into a pass.
- Synthetic project skill at `A/.agents/skills/acceptance-probe/SKILL.md`, a reference file with a unique nonce, and a script that prints only `pwd`, `WORKSPACE_DIR`, and synthetic `ACCEPTANCE_*` values. The skill script must not print all environment variables.
- `A/.env` and another workspace-relative env file containing synthetic `ACCEPTANCE_*` values only. A user ZIP skill with the same harmless reference/script structure, uploaded through UI.
- A harmless file outside A/B for explicit absolute-path reads and permission checks. Do not use personal files as permission probes.
- A second device or genuine disconnected-device state for heterogeneous/offline cases. If unavailable, mark those cases **BLOCKED: fixture unavailable**, not passed.

## Acceptance matrix

| ID  | Real UI steps                                                                                                                                                                 | Required observations                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W01 | In Web, open Home, create a new topic, open execution-target menu and sidebar.                                                                                                | No local-machine option, project grouping, or directory picker. Cloud sandbox and gateway choices remain.                                                                                    |
| W02 | Open each known historical pure-chat, scratch, and desktop project topic from Web history/search; navigate away and back.                                                     | Every historical topic remains discoverable and opens its original messages. Project topics must not vanish because project grouping is hidden.                                              |
| W03 | In Web open the existing device-bound project topic and ask the agent to run the harmless project marker/pwd probe.                                                           | Tool UI reports the original bound device and original project cwd. A browser host, arbitrary online device, or cloud fallback fails this case.                                              |
| E01 | In Electron open project A topic → click the **top new-topic button** → inspect composer → change to B before first message → send marker probe.                              | Draft initially inherits A; B is selectable before first send; execution captures B; original topic remains A. Repeat without changing project: execution stays A.                           |
| E02 | Open Electron Home/new topic and inspect default target; select another project/topic and return.                                                                             | Existing local-machine default and its original semantics remain intact. Project rows, individual topic rows, Recent ordering and group creation controls remain usable.                     |
| E03 | In an unbound local topic send several pure-chat messages explicitly requesting no tools. Navigate away/back.                                                                 | No project or temporary-workspace tag appears. Supplemental before/after filesystem + workspace-row evidence confirms **zero** new scratch.                                                  |
| E04 | In the same topic ask for one actual `pwd` tool call; ask again, then retry the second assistant response using its visible retry control.                                    | First cwd-dependent operation succeeds; exactly one scratch is created/bound; all subsequent cwd values are identical; topic stays in Recent with the correct temporary label.               |
| E05 | In a separate unbound local topic ask to read the harmless file by its full absolute path without running commands.                                                           | Actual read tool succeeds after any normal consent; zero scratch created. A refusal or synthetic text without tool execution is not a pass.                                                  |
| E06 | Attempt the harmless file access outside the allowed scope, deny consent if prompted, then run an allowed in-scope operation.                                                 | Denied operation does not execute; allowed operation still succeeds. No broadened default permission or consent bypass.                                                                      |
| E07 | Open legacy directory topic A, run pwd, begin another turn, use visible stop/retry/resume controls, and change the current draft selection to B where supported.              | Captured legacy topic snapshot, retry and resume keep A cwd. Retried operations do not follow unrelated current composer selection. Record visible tool args/results and operation identity. |
| E08 | On a different device open an unbound directory-capable topic; click its visible choose-directory recovery action; choose a valid folder and send pwd.                        | Action opens a working picker/binding flow; first execution uses selected device/path. A disabled item, inert click or tooltip alone fails.                                                  |
| E09 | Open a topic already using scratch; follow its visible choose/reference-project action and select A.                                                                          | Product creates a new project topic referencing the original conversation; scratch topic remains bound to its scratch and is still in Recent.                                                |
| S01 | Open project settings; expand environment section, type synthetic unsaved key/value; collapse then expand. Repeat for env-file paths and skill-policy controls.               | All three sections start collapsed, preserve their unsaved drafts through collapse/expand, and save only when the user saves. No draft loss or implicit save.                                |
| S02 | Select fresh project A **without opening settings**; chat asks to discover and activate `acceptance-probe`, read its named reference and run its script.                      | Real discovery, activation, reference-read and execution tool calls occur. Correct nonce proves reference reading; script result proves execution. A model claim without those tools fails.  |
| S03 | Upload the synthetic user skill ZIP through UI, enable it through supported controls, then request it in a device-executed chat.                                              | Skill package is prepared on the selected device and its reference/script actually run. No dependency on opening unrelated project settings.                                                 |
| S04 | Run project skill script after saving synthetic env/env-file settings through UI.                                                                                             | Script `pwd` is the skill directory, while `WORKSPACE_DIR` and project `.env`/envFiles resolve from project A root. Values from B, app cwd or skill-local `.env` fail.                       |
| S05 | Cause a real, scoped scan failure using only a disposable fixture (e.g. temporarily unavailable fixture root); open/retry discovery. Restore fixture and click visible Retry. | UI shows an explicit failure and actionable retry, not an empty successful list. Retry recovers the skill list. Record exact fixture failure mechanism.                                      |
| D01 | With a topic bound to device A, make that device unavailable through a coordinated supported mechanism; ask for marker/pwd and retry.                                         | Clear offline/unavailable outcome; neither the current machine nor another device/cloud executes the command. Restore A and confirm explicit recovery uses A.                                |

Web executes W01–W03 and applicable historical/settings/skill/offline journeys supported by its UI. Electron executes E01–E09, S01–S05, D01 and historical visibility. After desktop creates fixtures, revisit local Web for W02/W03; this is cross-surface verification, not permission to skip the initial local-Web gate.

## Additional required cases from independent review

Rows below started **NOT RUN**; current local partial results are identified in the Status column. Both test-server environments remain NOT RUN for every row. Code review and unit regression results are not UI acceptance results. Run these rows after the local-Web gate and in the same environment order as the main matrix. Do not fabricate unavailable legacy/device fixtures, change the system clock, inject transport responses, or directly invoke stores/APIs to make a row runnable. Record fixture or timing constraints as BLOCKED when necessary.

| ID    | Extends | Real UI journey                                                                                                                                                                                                | Required evidence                                                                                                                                                                                                                                       | Status  |
| ----- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| W03-A | W03     | Open a historical topic with a complete desktop-local snapshot; change the agent's default target to another device/cloud through supported UI, then reopen the historical topic and execute the marker probe. | Original topic still dispatches to its captured device and cwd. Default target changes affect future topics only.                                                                                                                                       | PASS for no-device draft→original bound A actual execution; alternate device unavailable |
| W03-B | W03/E07 | Repeat using a half-migrated legacy topic that has a captured target/device and legacy cwd but no formal workspace ID; reopen after the device has been unavailable and then restored.                         | History remains visible; offline access preserves the original evidence; recovery formalizes the same path/device; retry/resume keep that cwd. No scratch or cloud fallback.                                                                            | BLOCKED: no genuine half-migrated legacy fixture; no fabricated rows |
| E04-A | E04     | In a fresh unbound local topic request an actual harmless failing command such as `false`; then request successful `pwd`.                                                                                      | Failed command exposes no successful binding or temporary tag. Successful second command binds exactly one deterministic scratch. Distinguish an unbound prepared folder from a persisted binding.                                                      | PASS: fresh false unbound→same-topic pwd binds |
| E04-B | E04/E06 | Trigger a genuine boundary rejection, and separately stop a still-running harmless first command through UI before it reports success.                                                                         | Rejection/cancellation does not publish successful scratch evidence or falsely mark the topic bound. Record whether the underlying process actually completed after cancellation.                                                                       | PASS: delayed Electron and Web cancellation retests; path denial and allowed follow-up |
| E04-C | E04     | Coordinate a connection loss after a harmless command succeeds but before scratch finalization; restore the connection and continue via the supported recovery UI.                                             | Original successful output remains visible, synchronization-pending state is clear, and recovery does not repeat the original side effect. The eventually persisted binding survives reload and keeps the topic in Recent.                              | BLOCKED: no reliable UI-only post-success/pre-finalize loss fixture; automatic coverage only |
| E04-D | E04     | Exercise retry while the same first tool operation is still in flight, where the product exposes that action; separately make two distinct harmless cwd-dependent calls in one turn.                           | Duplicate delivery of one operation/tool ID executes once. Distinct calls may execute separately but use one scratch. Record visible IDs when available and a synthetic append-only marker as supplemental evidence.                                    | BLOCKED for duplicate in-flight delivery: no visible retry control during execution; distinct-call variant NOT RUN |
| E04-E | E04-C   | After an unfinalized successful command in topic A, wait past the proof window using real elapsed time; retry through UI without another scratch operation.                                                    | Delayed replay renews available proof without rerunning A's command, and binding can finish. Record actual elapsed time; do not simulate this by changing clocks.                                                                                       | BLOCKED: no reliable UI-only post-success/pre-finalize loss fixture; automatic coverage only |
| E04-F | E04-E   | Repeat the delayed case, but first make topic B complete its own initial scratch command after A's proof window, then recover A. Also record a separate desktop-restart variant if supported.                  | Another topic's cleanup or process restart must not silently turn A's replay into a duplicate side effect. If durable replay is unavailable, the UI must give an explicit recoverable outcome.                                                          | BLOCKED: no reliable UI-only post-success/pre-finalize loss fixture; automatic coverage only |
| E05-A | E05     | Submit an absolute read as the ordinary first message, then compare a fresh retry and a later turn. Include a separate message with an attachment/reference that happens to contain a path.                    | First-message authorization works despite the assistant placeholder; authorized absolute reads create no scratch. Historical, attachment, injected-reference, and subagent paths do not acquire direct-user read consent.                               | PARTIAL: home first-message PASS; retry/attachment pending |
| S02-A | S02/S05 | Discover and use a project skill without ever opening settings; separately test a cold scan failure and a previously cached scan, then restore and retry.                                                      | Distinguish scan → registry discovery → activation → reference read → execution. A cached result is labeled as cached evidence, not proof that a new scan succeeded. Record the cache state because the server currently retains a one-hour scan cache. | PASS for recorded no-settings chain and cold settings/chat error→retry |
| S03-A | S03     | Upload and execute both a ZIP with root `SKILL.md` and one with `wrapped/SKILL.md`; repeat after the package cache has been populated.                                                                         | Script cwd is the actual SKILL.md directory on the selected device for cold and cached preparation. Reference paths and relative script paths both work.                                                                                                | PASS: both imports and Electron/Web root/wrapped actual execution, including populated cache |
| S03-B | S03     | In one real conversation activate a builtin/document-only skill, then a user ZIP; separately switch project skill → ZIP and ZIP → project skill.                                                               | The most recently activated executable skill determines the script directory across sources; non-executable activations do not block a valid executable skill.                                                                                          | PARTIAL PASS: project→ZIP→project actual chain; builtin-only variant pending |
| S03-C | S03-B   | Activate executable A, then B, then explicitly reactivate A through chat and execute A's probe.                                                                                                                | The accumulated conversation history recognizes A as most recent. Testing a manually ordered activation array is insufficient.                                                                                                                          | PASS: accumulated project→ZIP→wrapped→project reactivation |
| S04-A | S04     | Give project A root `.env`, a configured env file, skill-local `.env`, and project B different synthetic `ACCEPTANCE_*` values. Save managed synthetic values and execute project and ZIP probes.              | cwd/SKILL_DIR identify the chosen skill directory; WORKSPACE_DIR and env-file loading remain rooted at A. Managed precedence and env-file order match the saved settings, and B/skill-local decoy values never leak in.                                 | PARTIAL: project and both Web ZIP root env PASS; separate file-order pending |

For E04-A through E04-F, record successful tool output, persisted binding, Recent placement, and post-reload cwd separately. A passing main-process deduplication test alone does not cover renderer finalization or visible recovery. Use a harmless unique marker if an operation must prove it ran exactly once; never use a destructive command as the probe.

## Suggested chat probes

- Pure chat: `验收标记 <run>-chat。只回复“收到”，不要读取文件、执行命令或调用工具。`
- Cwd: `请实际调用命令工具仅执行 pwd，不要凭上下文猜测，也不要创建其他文件。`
- Absolute read: `请使用文件读取工具读取 <synthetic-absolute-file>，不要运行命令，不要创建目录。`
- Skill: `请发现并激活 acceptance-probe 技能，读取它指定的 references/probe.md，再按技能执行 scripts/probe.sh。请展示真实工具结果中的验收标记。`

## Evidence record (one per scenario per environment)

```text
Case / environment:
Candidate commit / dirty diff:
Start time (Asia/Shanghai):
Fixture names (synthetic only):
UI entry and exact actions:
Visible execution target / project:
Expected:
Actual:
Screenshot / visible transcript artifact:
Supplemental read-only filesystem/DB evidence, if needed:
Result: PASS | FAIL | BLOCKED | NOT RUN
Smallest reproduction / recovery:
```

Do not mark a long scenario passed merely because its first UI assertion passed. In particular, successful `pwd`, an actual retry/resume, skill activation + reference-read + script execution, and no fallback all require their own observations. Recheck failures after fixes against a newly recorded candidate revision.

### Electron stable-window retests

- S02 RETEST PASS at UI 19:35:53, same `tpc_X0Ner9dRF01G`: after the activation-state fix, actual `execScript` command `sh scripts/probe.sh` succeeded. Tool output: `CWD=/private/tmp/masterino-independent-acceptance-20260905/project-a/.agents/skills/acceptance-probe`, `WORKSPACE_DIR=/private/tmp/masterino-independent-acceptance-20260905/project-a`. Reference marker `PROJECT-REFERENCE-20260905-A` remains. `ACCEPTANCE_ROOT`, `ACCEPTANCE_FILE`, `ACCEPTANCE_PRIORITY` were UNSET before any env settings were saved; S04 env-file/precedence remains pending. Evidence `electron-project-skill-retest-pass.png`. The model's causal explanation of the earlier failure is not accepted as diagnostic evidence.
- E01 PASS for changed-project branch: from sent A topic, clicked top new-topic → draft inherited A with editable device/project → native picker changed to B → first `pwd` in `tpc_6xZHAT7qWq0q` actually returned `/private/tmp/masterino-independent-acceptance-20260905/project-b`. Project B group auto-expanded and showed the new row; reopened A still shows locked A. Evidence `electron-inherit-change-to-b-pass.png`. The additional unchanged-project execution branch remains pending.
- E03 started at UI 19:40:04: top new-topic from A → explicitly choose 不使用项目, keep 本机 → send pure chat only. Supplemental read-only scratch baseline contains one existing directory from Web Gateway; saved `scratch-before-electron-pure-chat.json`. Compare again after pure chat and after first cwd operation, without directly invoking runtime operations.

Remaining S03 plan: upload the prepared synthetic root/wrapped ZIPs through Electron's own skill-management UI, then use the same installed user skill from Web to test server-to-device package preparation and execution. This does not pass or bypass Web upload: Web's extension file-selection permission remains BLOCKED.

### Additional live findings

- E03 two-message pure-chat check PASS for no creation: `tpc_18jqw0s4WRxv` returned CHAT-ONE and CHAT-TWO without tool calls or directory label. Read-only scratch directory comparison before/after is identical (one existing Web scratch); no folder for this pure-chat topic. `electron-pure-chat-no-project.png`, `scratch-before-electron-pure-chat.json`, `scratch-after-electron-pure-chat.json`. First cwd operation and retry remain pending.
- Web Gateway third run `tpc_40zGCwZVqWL8`: real `pwd` output visibly returned the device scratch path ending `/scratch-workspaces/tpc_40zGCwZVqWL8`; execution/output subcase PASS, `web-gateway-third-pwd-output.png`. The UI still says 手动批准 but no approval was presented: FAIL, parent confirmed missing userInterventionConfig in the interactive Gateway request.
- Third run failed to finish cleanly and proposed a second command despite the one-command instruction. Parent's read-only event inspection identified it; acceptance immediately clicked the real Stop control. UI confirmed `已中断 · 接下来需要做什么？` and displayed second tool args `cd ~/Desktop/codes/Masterino/apps/desktop && pwd`, with no visible output for that second call. Do not claim that the extra command completed. Evidence `web-gateway-third-stopped-extra-command.png`. Further requests paused until manual-approval repair is supplied.

### Web fourth approval/rejection retest — candidate 310209d5

- Fresh topic `tpc_V9VGB8BsxTos`, same local Chrome entry, selected BIELNB4284 with visible 在线 and 手动批准. Requested exactly one `pwd`. Real command approval appeared before execution. After clicking Submit, tool card showed `/Users/a10507479/Library/Application Support/masterino-desktop-local-35fece717f80/lobehub-storage/scratch-workspaces/tpc_V9VGB8BsxTos`; UI naturally returned to idle without a second command. Approval → actual output → natural completion subcases PASS. Evidence `web-gateway-fourth-pwd-approval.png` (development overlay may obscure part), `web-gateway-fourth-output-final-mismatch.png`.
- **FAIL: final answer contradicts successful stdout**. Same topic final text claims the raw output is empty / stdout not captured, while the actual tool card visibly contains the path. Reported immediately to parent for approval-resume tool-content investigation; do not mark complete conversational result passed.
- Fresh rejection topic `tpc_pRqeLZXM1MK2`: approved device-tool activation only, then selected the second option on the actual `pwd` approval, entered `Reject this command. Do not execute or retry any tool. Reply DENIED and finish.`, and clicked Submit. Expanded tool card says `本次技能调用已被拒绝` with the rejection text; final response says DENIED and ends, no stdout or retry. Read-only filesystem check confirms no scratch directory for this topic. Rejection/no-execution PASS. Evidence `web-gateway-deny-selected.png`, `web-gateway-deny-finished.png`.
- UI caveat: collapsed operation summary still says `运行了命令` even for a denied command; expanded detail is accurate. Development ReactScan notification overlay initially intercepted a Submit click; closed its Notifications panel and used the product right sidebar to expose Submit. This interception is environmental, not a failed business approval.
- Both requests finished before parent-requested proxy restart window; no refresh occurred during a running request.

### Electron first scratch execution — local candidate 310209d5

- 23:06:43 sent `E-FIRST-SCRATCH-20260905` in the existing pure-chat `tpc_18jqw0s4WRxv` with 本机 and no project. Real `pwd` approval appeared; after UI approval at ~23:08, actual tool output and final answer both returned the topic's deterministic scratch path. Composer shows `本话题的临时目录已锁定` plus 临时; sidebar row remains under 最近. E04 first-success/create/bind/recent subcases PASS.
- Supplemental read-only baseline immediately before first pwd had 3 scratch directories and no folder for this topic. After success it had 4, with exactly one addition: `tpc_18jqw0s4WRxv`. Evidence `scratch-before-electron-first-pwd.json`, `scratch-after-electron-first-pwd.json`, `electron-first-scratch-pwd-pass.jpeg`.
- Repeated pwd, visible retry, navigation/reload persistence, failed-first-operation binding, cancellation and scratch→referenced-project conversion remain NOT RUN. Parent's server approval-output repair does not change this Electron local execution path. No environment restart occurred during the observed successful request.

### E05/E05-A FAIL — absolute first-message read

- 23:12:54, after parent confirmed proxy recovery, Electron top new-topic kept 本机 with no project. First message explicitly requested the file-reading tool for `/tmp/masterino-independent-acceptance-20260905/absolute-read-probe.txt`, forbidding commands/other files. Topic `tpc_WhJZihbtuuYj`, title `请求读取指定文件内容`.
- Actual readFile path matches the direct user request, but the tool card shows a red failure and `INTERVENTION_REQUIRED`. No approval/recovery UI appeared; the model incorrectly presented this error as file contents and naturally ended. Expected synthetic marker `ABSOLUTE_READ_MARKER=20260905-INDEPENDENT` was never returned. Reported immediately; `electron-absolute-read-intervention-fail.jpeg`.
- Scratch directory count stayed 4, no new directory or topic folder: no-scratch subcase PASS, actual authorized read FAIL. Supplemental `scratch-absolute-read-check.json`. Do not accept the model's text as a successful read.

### E05/E05-A supported-boundary retest PASS

- Parent clarified automatic direct-message read consent covers home paths or native-picker-approved mount roots; global `/tmp` is outside that boundary. The preceding `/tmp` read is therefore an E06 boundary/approval-recovery failure, not evidence that automatic consent should widen to global `/tmp`.
- Created only synthetic `/Users/a10507479/masterino-independent-acceptance-20260905/absolute-read-probe.txt`, containing `ABSOLUTE_HOME_READ_MARKER=20260905-INDEPENDENT`. At 23:18:25 sent a fresh first message with this exact path, 本机/no project, topic `tpc_WixYC7XbOZqX` (`读取指定文件内容请求`). Actual read succeeded and the final answer contained the exact marker.
- Expanded tool UI explicitly says `已按你的消息放行读取`, `仅只读、仅限本次操作，且已经执行完毕`, and shows the exact authorized path. Optional `保留到本话题` was NOT clicked. Read-only scratch count stayed 4, with zero additions. `electron-home-absolute-read-pass.jpeg`. First-message automatic read and zero-scratch subcases PASS; later-turn/retry and attachment-only nonauthorization remain pending.

### Settings entry discovery and interrupted preparation

- Before repair, Electron application settings had no Devices sidebar link, and project row/topic menus offered no env settings. Parent confirmed the existing device page was excluded by the settings route allowlist and restored Electron-only Devices. After HMR, real settings → Devices → BIELNB4284 card opens the detail panel with A/B projects and recent directories. Each project's 工作区环境变量 / 环境文件 / 工作空间技能 begins collapsed. `electron-project-settings-default-collapsed.jpeg`; draft preservation/save not yet tested.
- S03 initial actual click path: composer add-context → 技能 → submenu 技能管理 → `app://renderer/settings/skill`. It rendered only 敬请期待 / 返回对话, no upload. `electron-skill-management-coming-soon.jpeg`; reported as blocked by missing product route, parent restoring route. No ZIP uploaded yet.
- Settings shared-file changes caused full renderer loading twice while navigating menus (no in-flight command or saved/draft setting). Those attempts are environmental interruptions, not passes. Parent requested a stable-window pause before entering any env drafts.

### S01 collapsed draft preservation PASS — stable settings repair

- Real settings → Devices → BIELNB4284 → project-a: all three sections initially collapsed. Expanded workspace env, entered synthetic `ACCEPTANCE_PRIORITY=managed-project-a` with secret toggle off; collapsed and reopened. Name, value and toggle remained, saved-list still empty (no implicit save). Clicked Save; UI confirmed 环境变量已保存 and listed ACCEPTANCE_PRIORITY configured.
- Environment files: entered `.env` then `acceptance.env` on separate lines, collapsed/reopened; both paths and order remained (2/10). Clicked 保存文件; UI confirmed 已保存环境文件路径.
- Skill policy: toggled 包含个人技能 off without saving, collapsed/reopened; off remained and Save enabled. Restored on; Save became disabled, confirming original stored policy unchanged. No skill-policy save was performed.
- Evidence: `electron-env-draft-preserved.jpeg`, `electron-envfiles-draft-preserved.jpeg`, `electron-skill-policy-draft-preserved.jpeg`. S04 execution of the saved env settings remains pending.

### S04/S04-A project probe PASS

- 23:34:32 in original project A `tpc_X0Ner9dRF01G`, requested existing activated skill via execScript, command `sh scripts/probe.sh`, forbidding manual env sourcing or extra commands. Inspected actual approval parameters and approved through UI.
- Actual successful tool output and final answer agree: `CWD=/private/tmp/masterino-independent-acceptance-20260905/project-a/.agents/skills/acceptance-probe`, `WORKSPACE_DIR=/private/tmp/masterino-independent-acceptance-20260905/project-a`, `ACCEPTANCE_ROOT=project-a`, `ACCEPTANCE_FILE=project-a`, `ACCEPTANCE_PRIORITY=managed-project-a`. This proves skill-directory cwd with A-root .env/envFiles and managed-value precedence; B and skill-local decoys did not appear.
- Natural completion observed. `electron-env-root-script-pass.jpeg`. ZIP variant and separate configured-file-order precedence remain pending; no claim beyond this executed project probe.

### S03 root ZIP upload FAIL — candidate 67a8bd73

- 23:45:02 Electron `app://renderer/settings/skill` → Skills → import dropdown → 上传 Zip → native picker selected `acceptance-root.zip` (666 bytes) → 打开. UI rejects with `导入失败：Executable or macro-enabled Skill file is forbidden: scripts/probe.sh`. The synthetic package contains SKILL.md, reference and a harmless probe script. No installation succeeded.
- Evidence `electron-zip-script-upload-rejected.jpeg`; reported immediately to parent. Root execution and Web same-user ZIP→device are blocked by upload validation; wrapped variant remains NOT RUN, not inferred from root.

### E06 fresh once-only path approval PARTIAL/FAIL — candidate 67a8bd73

- 23:46:25 fresh Electron topic `tpc_bR5n4PFz472g` on 本机/no project, direct read-only request for the synthetic /tmp file. Actual path intervention now appears with `/private/tmp/masterino-independent-acceptance-20260905/absolute-read-probe.txt`, 读取, options 仅本次 / 本话题记住 / 拒绝. Clicked 仅本次. Approval appearance/limited-path subcase PASS.
- After approval UI marks tool green and shows a file card but returns to idle without any final response. Actual tool debug → 返回结果 panel is entirely empty; expected marker is not visible. Recovery execution/conversational completion FAIL, reported immediately. A green check/file card alone is not accepted as successful reading.
- Scratch stays four directories, no folder for this topic. Evidence `electron-tmp-once-approval.jpeg`, `electron-tmp-once-empty-result.jpeg`. No refresh/restart during request; old terminal failure was not reused.

### S03 root ZIP import RETEST PASS — 67a8bd73 plus parser repair

- 23:53 native chooser reselected the unchanged `acceptance-root.zip`; upload succeeded and 自定义 Skills lists `acceptance-zip-probe`. Detail page visibly lists SKILL.md, references/probe.md and scripts/probe.sh and matches the synthetic description/instructions. `electron-root-zip-import-pass.jpeg`. Upload subcase PASS; actual execution still pending. No source-file workaround or package rewrite was used.

### S03/S03-B/S04-A root ZIP execution PASS — parser/grouped-message repairs

- 23:55:19 original project A topic `tpc_X0Ner9dRF01G`: actual chat activated `acceptance-zip-probe`, read `references/probe.md`, then requested `execScript` with `sh scripts/probe.sh`. UI approval parameters were inspected and approved. Natural final response contains `ZIP-REFERENCE-20260905`.
- Expanded actual execScript output and final answer agree: CWD is desktop `file-storage/skills/extracted/ef44161e4a318319ce7d7e1364107ec5b659337349adc1a19529d4852d1b0794`; WORKSPACE_DIR is `/private/tmp/masterino-independent-acceptance-20260905/project-a`; ROOT=project-a, FILE=project-a, PRIORITY=managed-project-a. This proves project→ZIP executable selection and project-root env preservation. `electron-root-zip-exec-pass.jpeg`.
- Wrapped package, Web device preparation, ZIP→project/reactivation and cache variants remain pending.

### S03 Web ZIP→bound device FAIL

- 23:58 Web same user opened original desktop project A `tpc_X0Ner9dRF01G` from visible history; execution target shows BIELNB4284. New W-ZIP-DEVICE-20260905 request explicitly activates acceptance-zip-probe, reads reference, and awaits manual execScript approval. Approved exact `sh scripts/probe.sh`.
- Actual expanded tool returns `The verified skill directory is outside the device workspace.` and summary marks one failure; final accurately reports that error and ZIP-REFERENCE-20260905. No stdout, no alternate command/cloud fallback. `web-zip-device-boundary-fail.png`. Device package preparation/execution FAIL; reference-read and manual approval subcases PASS.
- Before this run the existing Web tab displayed HTTP500; clicked its visible 重新加载 after parent authorization and normal product loaded. Rejection summary now accurately says 已拒绝1次工具调用 (UI retest PASS). No refresh or runtime mutation occurred during this ZIP run.

### Web manual pwd stdout RETEST PASS — 2026-09-06 00:00

- Fresh topic `tpc_Mu5fcttBBzZu` from top new-topic, selected visibly online BIELNB4284, kept 手动批准. Actual command approval displayed exactly pwd; clicked Submit.
- Actual tool returned the device scratch path ending `/scratch-workspaces/tpc_Mu5fcttBBzZu`; the final assistant response exactly matches this current raw stdout and naturally ends. No extra command was requested. `web-pwd-stdout-retest-pass.png`. This supersedes fourth-round final-empty-stdout failure.

### E06 second fresh retest still FAIL — grouped-message repair

- 2026-09-06 00:03:01 fresh `tpc_AkRo16KJuOtF`, after the supplied shared HMR completed. Exact same synthetic /tmp read, visible limited-path approval, clicked 仅本次. Again green tool/file card, entirely empty actual 返回结果 and no final assistant response; UI idle. `electron-tmp-once-retest-empty.jpeg`. Reported immediately with new topic ID. No old terminal message reused.

### E04 repeated pwd and visible retry PASS

- 2026-09-06 00:05:30 reopened original purechat→scratch topic `tpc_18jqw0s4WRxv` after intervening navigation/HMR. Existing locked temporary path remained and topic stayed under Recent. Actual second pwd approval→execution→final returned the original tpc_18jqw0s4WRxv scratch path.
- 00:07:19 clicked final-message more menu → 重新生成, then inspected and approved newly presented pwd. Actual regenerated tool and final response returned the identical original path; naturally finished. This was the visible retry action, not a manually sent retry prompt.
- Read-only scratch baseline and post-repeat/post-retry lists match exactly (five directories, no additions); `scratch-repeat-retry-check.json`. `electron-scratch-repeat-pass.jpeg`, `electron-scratch-visible-retry-pass.jpeg`. No directory created for either failed /tmp read topic.

### S03-A wrapped ZIP import PASS

- 2026-09-06 00:12 native picker imported `acceptance-wrapped.zip`, containing wrapped/SKILL.md, wrapped/references/probe.md and wrapped/scripts/probe.sh. To keep both synthetic packages independently identifiable, changed only this disposable package name to acceptance-wrapped-probe and reference marker to WRAPPED-REFERENCE-20260906 before upload. Root package and installed root skill unchanged.
- UI lists both custom skills; wrapped detail shows the expected SKILL.md/reference/script tree. `electron-wrapped-zip-import-pass.jpeg`. Import PASS; actual wrapped execution/cwd and cached variants pending.

### S05 prepared scoped cold-scan failure fixture

- Disposable `/tmp/masterino-independent-acceptance-20260905/project-scan` has `.agents/skills/acceptance-scan-probe/SKILL.md` and marker SCAN-RECOVERED-20260906. Only this fixture's `.agents/skills` directory is chmod 000 to cause a real EACCES scan failure. Root stays selectable by native picker. No application API or scan function invoked.
- Restore this fixture directory to 0755 before clicking the real Retry. Preparation is not a UI result; scenario NOT RUN until runtime stable window.

### E06 third fresh retest FAIL — bfa3e615

- 2026-09-06 00:27:42 fresh Electron tpc_bb2e7OTWr9rx. Model first asked textual confirmation without a tool; a follow-up explicitly requested readFile to trigger application permissions. 00:28:20 actual exact /private/tmp file permission appeared, clicked 仅本次. At 00:28:53 green tool/file card and idle, still no marker or final answer. Recovery remains FAIL.
- During subsequent visible tool-detail inspection (row arrow and unlabeled tool controls), UI showed an orphan-tool warning. No labeled delete control was selected, but one unlabeled inspection click may have removed the assistant message; parent suspected this from the resulting orphan warning. The post-inspection state is not clean failure evidence. The valid observation is the earlier 00:28:53 idle/file-card/no-content state. Preserved screenshot electron-tmp-once-third-orphan.jpeg and reported exact intervening clicks.

### S03/S04-A Web root ZIP bound-device RETEST PASS — bfa3e615

- 2026-09-06 00:31–00:32 original A topic tpc_X0Ner9dRF01G. Before request, top new-topic device menu visibly confirmed Apple BIELNB4284 在线, then returned to A. New root ZIP request reactivated acceptance-zip-probe, read reference, presented exact sh scripts/probe.sh manual approval.
- Approved and naturally finished. Expanded actual result says Command completed successfully, ZIP cache root ef44161e4a318319ce7d7e1364107ec5b659337349adc1a19529d4852d1b0794 as CWD; WORKSPACE_DIR=A, ROOT/FILE=project-a, PRIORITY=managed-project-a. Final agrees and includes ZIP-REFERENCE-20260905. web-root-zip-device-retest-pass.png. This supersedes outside-workspace failure for root ZIP; wrapped/cold variants remain pending.

### E06 fourth fresh once-only approval RETEST PASS — source consistency repair

- 2026-09-06 00:34:31 new tpc_pfqg22vRYpbh, first-message readFile request for exact synthetic /tmp file. Actual limited Read approval appeared; clicked 仅本次. Tool visibly returned 42/42 and ABSOLUTE_READ_MARKER=20260905-INDEPENDENT. Final repeats marker and naturally finishes. electron-tmp-once-fourth-pass.jpeg. No scratch folder for this topic (supplemental read-only list still five). Supersedes prior blank-result recovery failures; separate path denial remains pending.

### S03-A Web wrapped ZIP execution PASS

- 2026-09-06 00:35–00:36 same bound A topic, activated acceptance-wrapped-probe, read reference and manually approved exact sh scripts/probe.sh. Expanded actual output reports success with CWD=skills/extracted/02a93ce3bf67111c553c572093a3b99ca96c9f98bbda3911f96605e27639fbc4/wrapped (SKILL.md root), project A WORKSPACE_DIR and ROOT/FILE=project-a, PRIORITY=managed-project-a. Final agrees and contains WRAPPED-REFERENCE-20260906; natural completion. web-wrapped-zip-device-pass.png.

### S05 real scan failure/retry PARTIAL PASS

- Fresh project-scan selected by native folder picker while only its .agents/skills had mode000. 00:37:44 first chat tpc_PfihV7nMcF5A immediately became idle with blank assistant and no visible error; chat feedback FAIL, electron-scan-chat-empty.jpeg.
- Settings→Devices→BIELNB4284→project-scan→工作空间技能 showed 无法扫描项目技能，请检查设备连接后重试。 and actual 重试 button. Saved electron-scan-error-visible.jpeg. Restored only synthetic skills dir to0755 then clicked 重试; error cleared and 此目录中发现的项目技能1 appeared. Settings error/retry PASS. Permission restored; no application API scan called.

### Web ZIP→project reactivation FAIL (new request)

- After wrapped success, W-REACTIVATE-PROJECT-20260906 in original A topic tpc_X0Ner9dRF01G produced two visible acceptance-probe activations, both expanded regions empty. No reference, script approval, final or visible error; idle. web-project-reactivate-empty.png. Parent informed. Independent scan fixture was inaccessible during this attempt; original A files unchanged. Fixture permissions subsequently restored. Cause not inferred from UI.

### E04-A failed-first command binds scratch FAIL

- 2026-09-06 00:41:28 fresh 本机/no-project tpc_7F6s8FFf2rcC. Requested only false, manually approved exact command. Actual tool says Command failed with exit code1, but composer immediately shows 本话题的临时目录已锁定 and scratch path ending this topic. electron-first-false-bound-fail.jpeg. Failure-before-bind requirement FAIL; no subsequent pwd sent yet. Parent informed.

### E04-B first Stop attempt INCONCLUSIVE timing

- 00:42:58 fresh tpc_ss7KenMc1QUP requested sleep10. After approval screenshot shows 调用工具中00:00 and Stop. Next real screenshot-grounded Stop click returned 已中断 plus Command completed successfully and scratch bound. Command may have completed in the interval between tool calls; this is not evidence of cancellation-before-success. Parent asked for supplemental timing, longer harmless sleep may be needed. electron-sleep10-stop-timing-uncertain.jpeg.

### E04-B actual in-flight cancellation PASS

- 2026-09-06 00:44:58 fresh tpc_GBfweoxlhtGL requested exact sleep30. Manually approved, observed 调用工具中00:00, immediately clicked screenshot-grounded Stop. UI says 你已取消本次技能调用, idle, no temporary/project binding label. electron-sleep30-stop-pass.jpeg. No later success/pwd request sent; supplemental physical scratch presence recorded separately and does not imply persisted binding.

### Stable-window remaining work — 2026-09-06 00:47

- Await parent repair/restart: fresh false→pwd, fresh scan chat failure→visible retry, Web A project-source activation/reference/script.
- Coordinate actual device offline→Web original A request/no fallback→device restore→explicit recovery.
- Complete project→ZIP reactivation/cached wrapped on Electron using top-new inherited A unchanged; separate path rejection and allowed follow-up.
- Real UI heterogeneous provider availability check for E08/E09; legacy partially migrated fixture cannot be fabricated. Post-success/pre-finalize fault-timing cases remain BLOCKED as stated.
- Test-server Web→Electron still NOT RUN, waiting parent release only after local main-chain completion.

### D01 coordinated offline PARTIAL PASS

- Parent exited actual Electron at00:52 while Web backend remained up. Original A topic W-OFFLINE request asked exact pwd. Approved only required tool activation. Actual expanded listOnlineDevices result is No online devices found.; final reports BIELNB4284 offline, no stdout/fallback and ends. web-device-offline-no-fallback.png.
- No actual pwd was proposed because model first checked device list; visible offline/no-fallback branch PASS, backend offline-command rejection not directly exercised. Parent notified to restart device; same binding recovery pending.

### W03/D01/S03-B/C Web original project recovery PASS

- After coordinated device restart, 00:57 fresh W-PROJECT-RECOVER in original A tpc_X0Ner9dRF01G explicitly reactivated Project Skill acceptance-probe, read reference and manually approved exact sh scripts/probe.sh. Expanded actual result success: CWD=A/.agents/skills/acceptance-probe, WORKSPACE_DIR=A, ROOT/FILEproject-a, PRIORITYmanaged-project-a. Final agrees with PROJECT-REFERENCE-20260905-A, naturally ends. web-project-reactivate-recovery-pass.png.
- Covers original desktop-bound device execution after offline recovery and real accumulated project→ZIP→wrapped→project reactivation. Previous Web top-new draft showed no-device, yet returning to original A preserved BIELNB4284 and this execution A. No default-target drift.

### E04-A false→pwd RETEST PASS

- New tpc_QXdG3jUR3wpK at00:57:44: manually approved false, actual exit1 and final agreed, no temporary/project binding label. electron-first-false-unbound-pass.jpeg.
- Same topic01:00:22 requested exact pwd, manually approved. Actual and final stdout match topic deterministic scratch; only now locked temporary label appears and topic stays Recent. electron-false-then-pwd-bind-pass.jpeg. Supersedes earlier false binding failure.

### S05 chat error→visible retry RETEST PASS

- 01:02:15 fresh inherited project-scan tpc_GuCFKNGa0XI7, scoped skills mode000. Chat displays exact EACCES permission denied scandir path, not blank. electron-scan-chat-error-pass.jpeg.
- Restored only fixture skills to0755. Clicked screenshot-visible circular-arrow retry01:03:02; actual Project Skill activation acceptance-scan-probe and final SCAN-RECOVERED-20260906, natural finish. electron-scan-chat-retry-pass.jpeg. No new retry prompt/API injection. Error and recovery PASS, supersedes first blank scan chat.

### E01 unchanged inheritance / S03-A Electron cached wrapped PASS

- Original A→top new-topic retained editable A; made no target/project change. First message01:04:55 tpc_Hd1FOV3pl0d4 activated wrapped user skill, read reference, manually approved exact sh scripts/probe.sh. Actual expanded stdout and final agree: cached02a93.../wrapped cwd, WORKSPACE_DIR=A, ROOT/FILEproject-a, PRIORITYmanaged-project-a, WRAPPED-REFERENCE-20260906. Natural finish, new row under A with locked A. electron-wrapped-cache-inherit-a-pass.jpeg.

### E04-B delayed binding FAIL — supersedes immediate-only PASS

- At01:06–01:07 after navigation/device restart, sidebar shows a temporary path for canceled tpc_GBfweoxlhtGL. Reopened and expanded its tool-row text: UI simultaneously says 你已取消本次技能调用 and 本话题的临时目录已锁定 with that topic scratch. electron-cancel30-delayed-binding-fail.jpeg. No new command/retry was sent in this topic after Stop.
- Immediate cancellation UI feedback passed, but persistence/delayed binding fails. Reported immediately; do not treat initial absence of temporary tag as complete cancellation PASS.

### E06 path denial and permitted follow-up PASS — 8f716753

- Fresh tpc_CbwfEdbILZ6v exact /tmp read received actual path approval; clicked 拒绝. Visible tool rejection and final DENIED, idle, no temporary binding. electron-path-denial-pass.jpeg.
- Same topic 01:13:19 explicitly requested only synthetic home file. Expanded real read result shows only-this-operation read authorization, exact path, 47/47 and ABSOLUTE_HOME_READ_MARKER=20260905-INDEPENDENT; final agrees, no scratch tag. electron-path-deny-home-followup-pass.jpeg. Rejected /tmp path was not retried.

### E04-B delayed cancellation RETEST PASS — 8f716753

- New tpc_62iN0NO0qU1S first proposed background sleep30; rejected without execution. Follow-up01:15:06 explicitly requested run_in_background=false, approved actual foreground sleep30 and clicked visible Stop while 调用工具中00:00. UI confirms 你已取消本次技能调用.
- After42seconds navigated away/back; expanded canceled tool still canceled, no temporary binding in composer/sidebar. electron-cancel-delayed-retest-unbound.jpeg. This exceeds the underlying30second command duration.
- Same-topic01:16:56 manually approved pwd; actual stdout and final match deterministic topic scratch, and only now temporary binding appears in Recent. electron-cancel-then-pwd-pass.jpeg. Supersedes prior delayed binding failure.

### Web delayed cancellation — e29407d2

- Fresh Gateway topic tpc_pFJu6N5m3LGh01:19:12, online BIELNB4284 selected through UI. Approved exact foreground sleep30. Observed running00:05 and clicked Stop; immediate 已中断. After35seconds switched away/back. Actual expanded persisted output says Command is still running after the wait window. shell_id:sh-7, no final success claim.
- Opened same topic via Electron Home Recent after two minutes: no temporary binding in composer or Recent row, while adjacent successful scratch topics show their tags. web-cancel-delayed-unbound.png and web-cancel-electron-unbound.jpeg. No-binding branch PASS; this does not prove process termination.

### Heterogeneous real precondition / E08 action — execution FAIL pending repair

- Home UI detected Codex CLI; clicked its 添加助手 to create agt_1JhFvBrD09yb. Unbound composer says 需要项目 and provides 选择项目. Click opens actual project list and folder chooser. Selected A, project becomes locked. UI action PASS on this available machine (second-device branch unavailable).
- Real first pwd request01:19:32 in tpc_Mi4ziGQAMrK4 gives Unable to receive agent results (404). Reopen the topic to reload saved messages. Cut away and reopened as instructed: same error, no result. electron-heterogeneous-result-404.jpeg. Parent identified missing same-origin events path in Electron proxy; repair/retest pending, not an external provider BLOCKED claim.

### Heterogeneous proxy-restart RETEST still FAIL

- Parent rebuilt/restarted Electron, new PID45483, preserved local profile. Reopened original Codex A topic, sent new harmless pwd follow-up01:25:27. New assistant independently displays the same Unable to receive agent results (404), alongside old01:19:32 failure. Thus this is not merely an old error banner. electron-heterogeneous-after-proxy-restart-404.jpeg. No actual cwd output; notified parent immediately and left idle scene.

### Remaining supplemental cases and concrete preconditions

- E07/W03-B: BLOCKED; available supplied legacy topics are plain chats, not half-migrated captured-cwd fixtures. Modern captured A and scratch retry paths passed; these do not prove legacy formalization.
- E08 second-device variant: BLOCKED; only BIELNB4284 is available. Same-machine heterogeneous required-project action actually opens a valid selector and binds A, but Codex execution currently FAIL as above.
- E09 existing heterogeneous scratch→referenced project: BLOCKED; new heterogeneous topics require a project before execution, and no genuine historical heterogeneous scratch topic is available. Normal scratch remains locked by expected product semantics. Do not create this precondition by editing an agent runtime or injecting stored snapshots.
- E04-C/E/F exact post-success/pre-finalize connection loss/replay: BLOCKED without a reliable UI-only fault window. Automated coverage reported by parent is supplementary, not real-UI PASS. E04-D same-tool in-flight replay has no visible supported retry control; distinct multi-call supplemental variant NOT RUN.
- E05-A attachment/reference-only consent and subagent variants remain NOT RUN; Web attachment upload specifically BLOCKED by extension permission. Main direct-first, later explicit home read and real path refusal/limited approval passed.
- S03-B document-only builtin intervening activation and S04-A separate env-file-order variant remain NOT RUN. Main actual cross-source reactivation, all script roots, project env loading and managed precedence passed.

### Heterogeneous owned-stream repair — connection recovered, execution still pending

- Candidate17dfb594 (desktop proxy73abbcdc), new01:28:42 owner-retest message in same Codex A topic. No404; server-running timer reached105seconds with no actual tool or text result. Parent read-only diagnostics found local lh launcher could not find unbuilt apps/cli/dist/index.js.
- At parent request, clicked real Stop; UI 已中断 and restored last prompt draft. electron-heterogeneous-cli-missing-stopped.jpeg. Connection no404 subcase improved; actual heterogeneous execution has not passed. Parent repairing local CLI build prerequisite.

### Heterogeneous full-chain RETEST PASS and local handoff — 01:34

- Parent built real local CLI; new01:32:23 E-HETERO-CLI-READY-RETEST in original tpc_Mi4ziGQAMrK4. Actual 运行命令:pwd shows success. Expanded stdout=/private/tmp/masterino-independent-acceptance-20260905/project-a; final matches, natural idle. electron-heterogeneous-pwd-retest.jpeg.
- Top new-topic→original topic link→wait for real latest-message refresh→expand pwd: exact stdout and final remain, project A stays locked. electron-heterogeneous-reopen-pass.jpeg. Supersedes the two404 attempts and missing-CLI empty run for the same-machine selected-project branch.
- Local main journeys now have no unresolved reproduced failure. Extra matrix BLOCKED/NOT RUN rows remain explicit and do not inherit this PASS. Both test-server stages remain NOT RUN.
- No in-flight UI request, no unsaved probe draft, scan fixture0755. Parent may pause owned local runtime for full type checks/release work. Acceptance uses only actual Browser/Computer Use actions; realUiAcceptance.ts is a reusable UI helper scaffold, not a claim that a standalone automated runner executed every journey.
