# dsh-emotion-profiles

Emotion profiles for DeepSeek Harness: twelve built-in personalities, each with
its own starting mood, its own small GRU (ONNX, hidden size 48, trained
offline), and its own persisted state snapshot. Every finished turn becomes a
`RunRecord`; the net turns a window of recent records into a valence/arousal
delta; the state decays toward the profile baseline by half-life; and the
current mood is injected into runtime-context as one Chinese line of at most
60 characters.

The plugin is self-contained: ESM, zero npm runtime dependencies, ONNX runtime
vendored in the package, and **zero interaction with dsh-recall** — no recall
events, no recall service, no recall storage, no shared schema.

## What it does

```text
turn/end ──► RunRecord ──► 8-record feature window ──► GRU(48) ──► Δvalence / Δarousal
                                                              │
  stored state ──► half-life decay toward baseline ────────────┴──► clamp ──► snapshot
                                                                              │
                                        ctx.systemPrompt.context() ◄── ≤60-char line
```

- **12 built-ins**: gentle, cold, passionate, joyful, sad, angry, anxious,
  calm, playful, tender, proud, curious — each with its own start state,
  baseline, half-life and tone hint.
- **Custom profiles**: pick a display name, id, description, start/baseline,
  half-life and tone; the net reuses one of the twelve shipped nets.
- **Runtime switching**: `emotion_switch_profile` tool or the Settings page.
  Mood is global — a switch applies to every session.
- **Settings page**: current state meters, the switch grid, the create form,
  plugin settings, recent runs and the consolidation export.

## Tool

`emotion_switch_profile({ profile })`

Accepts an id (`gentle`), a custom id, or a display name (`温柔`). Returns the
new profile, its state and the injected line. The switch persists the previous
profile's snapshot, writes the new active id to the plugin's own
`storageDomain`, and restores the target profile's state (or its start state for
a profile that was never used).

## Storage (independent tree)

```text
$DSH_HOME/emotion-profiles/
├─ registry.json                     # custom profiles (versioned envelope)
├─ settings.json                     # settings-page overrides
├─ _active.json                      # fallback only when storageDomain is absent
├─ _runs/<sessionId>/<turn>.json     # RunRecord, one per finished turn
├─ _consolidation/<ts>/              # exported offline corpus + manifest
└─ <profileId>/state.snapshot.json   # per-profile mood
```

The authoritative active-profile id lives in a `storageDomain` named
`emotion_profiles` (a single global record; the storage backend only accepts
unit names matching `^[a-z][a-z0-9_]*$`). The `_active.json` file is written
only when that service is unavailable, and the Settings page shows which mode is
in use.

## Model

- One ONNX file per built-in profile under `models/`, ~40 KB each.
- Input `runs[8,12]` (last eight run records, 12 bounded features), output
  `delta[2]` (raw readout; the host applies `0.30·tanh`, `0.20·tanh`).
- The graph is the GRU unrolled with primitive ops (`MatMul/Add/Mul/Sub/
  Sigmoid/Tanh/Gather`), so it does not depend on a recurrent-op kernel being
  present in the runtime build.
- `models/manifest.json` records seed, samples, epochs, eval loss, behavior
  probes and the sha256 of each file.
- Offline training lives in `scripts/train-nets.mjs` (BPTT + Adam, synthetic
  teacher policy per temperament) and `scripts/onnx-writer.mjs` (hand-encoded
  ONNX protobuf — no Python in the build environment). The runtime only infers.

```bash
node scripts/train-nets.mjs            # train all twelve, rewrite models/
node scripts/train-nets.mjs --profile gentle --gradcheck
node scripts/verify-parity.mjs         # JS forward vs onnxruntime-web, hash check
node test/smoke.mjs                    # pure-Node smoke tests
```

## Settings page

Settings → **情感人格**: current profile and meters, switch grid, create form,
plugin settings (injection, decay strength, run retention, consolidation
export), and the recent run table. The page talks to the Host over the guarded
same-origin route `/emotion-profiles/api`.

## Configuration

```yaml
- id: emotion-profiles
  config:
    defaultProfile: curious
    injection: { enabled: true, order: 300, maxChars: 60 }
    decay: { enabled: true, strength: 1 }
    runs: { enabled: true, retentionDays: 30, maxPerSession: 200, maxTotal: 2000 }
    net: { enabled: true, window: 8 }
    consolidation: { exportEnabled: true }
    debug: false
```

Settings-page changes are written to `settings.json` and merged over this row,
so the deployment file survives upgrades.

## Lifecycle

`apply()` registers everything as Cordis effects:

- turn hooks (`session/event`, `session/flush`, `session/disposed`) are removed
  on unload;
- runtime-context is a thunk, so it disappears with the registration;
- the tool and the HTTP route are effects;
- teardown flushes the state and run snapshots synchronously, then releases
  every ONNX session and closes the active-profile domain.

Turn handling never blocks the loop: the run walk is serialized on its own
promise chain, and a failing net or a missing model degrades to decay-only.

## Isolation from dsh-recall

- no import of `dsh-recall` or its models, no event subscription, no service
  injection, no read/write of any recall file or index;
- a separate data root and a separate `storageDomain`;
- the only shared ideas are "versioned JSON envelope" and "vendor an ONNX
  runtime", both implemented independently here.

## Licenses

The bundled `vendor/ort` is **onnxruntime-web** (MIT, © Microsoft Corporation);
its license header is preserved in `vendor/ort/ort.all.min.mjs`. The rest of the
package is MIT, see `LICENSE`.
