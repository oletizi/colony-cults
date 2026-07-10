# Translation Engine & Model Comparison

**Date:** 2026-07-09
**Scope:** `translate` / `translate-source` OCR-translation pipeline (French → English), on the *La Nouvelle France* (PB-P001) corpus.
**One-line takeaway:** For this corpus, **Codex (gpt-5.5) and Claude Opus are quality-equivalent**, the cheap settings (`codex none` reasoning, `claude sonnet`) match the expensive ones, and **`claude haiku` is a false economy** (slightly worse *and* slowest).

---

## What was compared

The translation pass was run over **3 corrected-French pages** (same claude-cleaned French fed to every config, so only the *translation* step varies):

- **Page A** — dense front page, proper-noun / date heavy (2.8k chars)
- **Page B** — dense body (6.7k chars)
- **Page C** — body (3.0k chars)

Five configurations (2 providers × their quality/speed tiers):

| Provider | Configs | Tier axis |
|----------|---------|-----------|
| Claude (`claude --print`, isolated) | `opus-4-8`, `sonnet-5`, `haiku-4-5` | model size (best → fast) |
| Codex (`codex exec`, isolated) | `gpt-5.5` @ reasoning `high`, @ `none` | reasoning effort (best → fast) |

All configs used the shipped isolation flags and prompts. Judgment was a manual deep-read of Page A (the most discriminating page) against the French source, plus length/completeness checks on B and C.

---

## Results

### Timing (wall-clock, averaged over the 3 pages)

| Config | Avg time | Notes |
|--------|----------|-------|
| **claude-sonnet** | **17.0s** | fastest |
| codex-none | 19.9s\* | \*inflated by a concurrent batch — really faster |
| claude-opus | 23.2s | |
| codex-high | 25.3s\* | \*inflated; ≈ codex-none in quality |
| **claude-haiku** | **45.1s** | **slowest** — consistently, all 3 pages |

All five produced **full-length output** (char counts within ~0.5% of each other) — no truncation or incompleteness in any config.

### Quality (deep read of Page A)

All five are faithful, fluent, complete, and free of preamble/agentic leakage. The differences are **marginal** — small tells only:

- **Garbled OCR** — the source has `"— lard enseveli vivant"` (a mis-OCR of *vieillard* / "old man"):
  - **codex (both)** and **haiku**: kept `"lard buried alive"` — most faithful to the corrupted source; invented nothing.
  - **claude-opus**: `"bacon buried alive"` — over-translated the garble (lard → bacon).
  - **claude-sonnet**: `"buried alive"` — **silently dropped** the word (an omission; the least desirable behavior for an archive).
- **Proper nouns** (Quiros, Christopher Columbus, de Groote, Marquis de Rays): all correct in every config. `sonnet` slipped on `"Monsignor of Amata"` (mistranslated the `d'`); `codex-high` left `"Monseigneur"` untranslated (minor).
- **Minor**: `haiku` rendered `SOMMAIRE` as `"SUMMARY"` (vs the better `"CONTENTS"`) and headline-cased a sentence.

**Ranking on this page (all excellent; ordered by faithfulness):** codex-none ≈ codex-high ≈ claude-opus > claude-sonnet > claude-haiku. The gaps are small.

---

## Guidance

- **Default to `codex` (gpt-5.5) or `claude` (opus/sonnet) interchangeably for quality** — they are equivalent on this corpus. Codex is arguably a hair *more* faithful because it does not "improve" OCR garble.
- **Cheap settings are the value picks — no meaningful quality penalty:**
  - **`codex` at `none` reasoning** (the batch default) equals `codex` at `high` reasoning here — paying for `high` buys nothing for this task.
  - **`claude sonnet` matches `claude opus`** quality at the *fastest* observed time — the best claude tradeoff.
- **Avoid `claude haiku` for this job** — it was marginally weaker (formatting quirks, e.g. "SUMMARY") *and* consistently the slowest (likely CLI overhead dominating the small model). It is not a speed win.
- **Switch engines/models freely per run** via `--engine claude|codex` and `--model <name>`, or set defaults in `translate.config.json`. Each artifact's `.yml` records the engine + model that produced it, so mixed batches stay honest.
- **Codex model availability is gated by auth mode, not by codex itself.** On a **ChatGPT-account login**, codex is limited to a curated model set — on this account `gpt-5.5` works while `gpt-5`, `gpt-5-codex`, and `gpt-5.5-mini` return HTTP 400 *"not supported when using Codex with a ChatGPT account."* To reach other models (e.g. `gpt-5-codex` or mini variants), authenticate codex with an **OpenAI API key** (usage-based billing) instead of the subscription. Reasoning effort (`none`…`high`) is tunable regardless.

---

## Caveats (read these before over-trusting the above)

- **Small sample.** The quality judgment is a deep read of **one page** (Page A, chosen because it is the most discriminating — proper nouns, dates, a garbled token). Pages B and C were checked for length/completeness (all full), not deep-read line-by-line. A larger, blind, multi-judge evaluation could shift the fine ordering.
- **One corpus, one language pair.** French → English on 1880s Catholic-colonial newspaper prose. Rankings may differ on other material, languages, or document types.
- **Timing is indicative, not benchmarked.** The codex runs competed with a live translation batch for the same account, inflating their measured times; claude times were clean. The `haiku`-is-slowest finding was consistent across all three pages, but wall-clock depends on CLI/version/load.
- **The "quality" bar here is high across the board.** The practical conclusion is *"these are all good; pick on cost/speed,"* not *"one is clearly best."* Do not read the fine-grained ranking as a large quality gap — it isn't.
- **Model/version drift.** Findings are tied to the installed CLIs at the date above (claude-opus-4-8 / sonnet-5 / haiku-4-5; codex-cli 0.141.0 / gpt-5.5). Re-run the comparison after CLI or model updates.

*Reproduce:* run the same corrected-French page through each config with the shipped isolation flags (claude: `--print --disable-slash-commands --tools "" --append-system-prompt <sys> --model <m>`; codex: `exec <sys+prompt> -m gpt-5.5 -c model_reasoning_effort=<eff> -s read-only --ignore-user-config --ignore-rules --skip-git-repo-check --ephemeral -o <file>`), source on stdin, and compare outputs against the French.
