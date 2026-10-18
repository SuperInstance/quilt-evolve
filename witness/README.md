# witness/ — if it wasn't witnessed, it didn't happen

`ledger.jsonl` is an append-only, hash-chained receipt ledger of this repo's test
suite: one record per test file (path, source sha256, tests run), chained, plus one
`OUTCOME` recording the aggregate.

The idiom is ported from `SuperInstance/AI-Writings` -> `labs/situation-recorder/recorder.py`,
and is the same one already shipped in `SuperInstance/quilt-claw` -> `witness/ledger.js`.
The hash algebra is **byte-compatible** on purpose — same `fnv1a-64`, same canonical
JSON (`sort_keys=True`, compact separators), same `GENESIS = 0x0000000000000000`, same
chain rule:

    hash = "0x%016x" % fnv1a64( canon({ prev, ...envelope_without_hash }) )

Cross-checked against the quilt-claw implementation on 8 vectors — chain hashes and
canonical encodings agree byte-for-byte, including key ordering, astral-plane
unicode, control characters, and quoting.

## READ THIS: the committed ledger records `fail`, and that is not a bug

This repo's suite is **currently red**, and the witness exists precisely so that this
is a receipt rather than a surprise:

    $ npm run witness
    files      1
    tests      0   <-- EXPECTED 13, MISMATCH
    outcome    fail — 0 tests / 0 pass / 0 fail across 1 files
    FAILING FILES: test/evolve.test.js

**Cause: the TypeScript pin, not the dependency specs.** `test/evolve.test.js` builds
its own `dist` on line 10 (`execSync("npx tsc")`) before asserting anything. This
package declares `typescript: "^7.0.2"`, and TypeScript 7 removed `node10` module
resolution, which this repo's `tsconfig.json` asks for:

    tsconfig.json(16,25): error TS5108: Option 'moduleResolution=node10' has been removed.

So the suite throws before its first assertion and every run reports 0 tests. This is
pre-existing and independent of the `file:` dependency specs — it reproduces on a
pristine clone.

**The one-line fix (NOT applied here — it is a toolchain decision, not a dep decision):**

| option | effect |
|---|---|
| `"typescript": "^6.0.3"` | `tsc --noEmit -p tsconfig.json` exits **0**; suite then runs **13/13 passed** |
| keep `^7`, set `moduleResolution` to a supported mode | also works, but is a larger semantic change |

`^6.0.3` is the idiom already used across the `SuperInstance/quilt` monorepo
(`packages/core`, `packages/tui`, `packages/mcp`, `packages/sdk` all declare it).
Both options were verified; only the first is quoted here because it matches the house.

Once the pin is fixed, re-run `npm run witness` and the ledger rewrites itself from
`fail`/`0` to `pass`/`13` — and until then `--verify` correctly keeps reporting the
drift. **That is the system working, not the system broken.**

## What is different here, and why

`ledger.js` is not a copy-paste. Two things are adapted, and only two:

1. **The counter.** This repo's harness is hand-rolled, not `node:test` — it prints
   `=== 13/13 tests passed ===` rather than emitting TAP. Counting the runner's
   `# tests` would record `1` (one file) and witness a number this repo does not
   itself claim. So `runFile` reads the repo's own tally.
2. **`EXPECTED = 13`.** Claw's is 182. The count is whatever the repo actually asserts.

Everything that makes the chain worth anything — `fnv1a64`, `pyEscape`, `canon`,
`Ledger`, `verifyChain`, the tamper self-test — is byte-identical.

## Re-derive it

```bash
npm run witness            # rebuild the ledger from live test runs, verify, tamper self-test
npm run witness:verify     # re-derive the chain AND re-run every witnessed file
```

or directly:

```bash
node witness/ledger.js --verify             # full: chain + sha256 + live test counts
node witness/ledger.js --verify --chain-only # fast: chain + sha256 only, no test run
node witness/ledger.js                      # rewrite ledger.jsonl from scratch
```

## What breaks it

| tamper | detected by | exit |
|---|---|---|
| edit a test file (append a line) | sha256 drift | 1 |
| delete a test file | missing witness record | 1 |
| add an unwitnessed test file | file count mismatch | 1 |
| hand-edit `ledger.jsonl` | hash mismatch at `seq` | 1 |

## Why this exists

`@quilt/evolve` declares `@quilt/core` and `@quilt/ai` as dependencies, while its own
source defines its own compatible interface instead of importing one:

    /** A minimal AI engine interface (compatible with @quilt/ai's AIEngine). */

A dependency you never import is a dependency whose breakage you cannot observe. The
witness does not settle that question — but it makes the *actual* reach of this suite
a number you can check, rather than a claim you have to trust.

Note: the ledger records `tests` counts and `sha256`s, not wall-clock time or the
suite's result, so it stays byte-reproducible. Re-running the builder overwrites it
deterministically.
