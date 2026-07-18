# Phase 1 Data Model: English-Source Facsimile PDF

The feature adds **no new persisted artifact** — it reads the existing archive
shape and routes on a field already present. This documents the entities the
routing touches and the one in-memory field that must be surfaced.

## ReadingLanguage (in-memory, derived)

The per-source signal that selects the edition path. Derived from the folio
provenance `language` field (already written by every acquisition adapter).

| Value | Meaning | Path |
|-------|---------|------|
| `french` | FR-OCR │ EN-translation edition | existing French path — **unchanged** |
| `english` | English OCR is the reading recto; no translation | new English-source path |
| *(other)* | unsupported | **fail loud** — only FR + EN editions in scope |

**Derivation rules**:

- Read from folio provenance `language`, matched **case-insensitively** (V1:
  verify full-word "English"/"French" vs. a code against real sidecars; normalize
  at the seam if a code is used).
- A source's reading language is resolved **once** and MUST be consistent across
  its folios; a mixed-language source (some folios English, some French) **fails
  loud** (it is not a valid edition — surfaces an archive-data error).
- An unrecognized (non-FR/EN) language **fails loud** naming the source and the
  offending value.

**Surface**: exposed on the source resolution (`archive-source.ts`) or resolved
at edition-build entry (`archive-edition.ts`) and passed into per-page assembly,
so `loadArchivePage` can branch without re-deriving. (Exact placement is an
implementation detail; the folio provenance is already read in `loadArchivePage`
for `deriveOcrCondition`, and in `enumerateFolios` for object_store/sha256.)

## ArchivePageContent (existing — English-path semantics)

The intermediate `loadArchivePage` produces (`archive-page.ts`). On the English
path its fields carry English-source meaning:

| Field | French path (existing) | English path (this feature) |
|-------|------------------------|-----------------------------|
| `ocrFrench` | French OCR (recto left col / parallel source) | the English OCR (reused as the OCR-text carrier) OR the recto text — implementation places the English OCR so the english-only variant renders it as the reading recto |
| `english` | EN translation (recto reading col) | the English OCR reading text (english-only recto), OR left empty if `ocrFrench` carries it — the placement MUST make the english-only variant draw the English OCR as the single reading column |
| `untranslatable` | `true` only for a marked blank page | not applicable (no translation dimension) — `false` |
| `machineAssist` | translation engine/model/date, or null | **null** (no translation performed) |
| `ocrCondition` | OCR apparatus note or null | **carried through unchanged** (low-fidelity caveat surfaces here) |

> The precise field placement (which of `ocrFrench`/`english` carries the English
> OCR for the english-only variant) is fixed in the contract + tasks so the
> existing Typst english-only template renders a single reading column of the
> English OCR over the verso facsimile with no template change. The invariant:
> **the rendered recto reading text is the English OCR; no translation artifact
> is read.**

## Edition / Colophon (existing — English-source semantics)

- `machineAssist` label is **null** for English sources.
- The colophon gains an **OCR-transcription** line: the recto is a machine OCR
  transcription of the English original, carrying OCR engine/status + low-fidelity
  caveat when present; **no** machine-assisted-translation line.
- The pinned-archive reference (`archiveRef`) is **unchanged** (reproducibility).

## Fail-loud conditions (English path)

1. Missing English OCR for a page (neither corrected `pNNN.fr.txt` nor a
   positional `issue.txt` segment) → fail loud naming the page.
2. Unsupported reading language (non-FR/EN) → fail loud naming source + value.
3. Mixed reading language across a source's folios → fail loud.
4. Missing image master (unchanged from spec 014) → fail loud.
