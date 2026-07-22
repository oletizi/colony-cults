---
id: TASK-40
title: pdf-blankocr-png-unit-tests
status: To Do
assignee: []
created_date: '2026-07-17 22:24'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
ordinal: 40000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Archive-direct PDF (spec 014): the two live-acceptance fixes lack unit coverage (proven only by the real PB-P055 build, not in CI): (1) an untranslatable page with empty OCR -> ocrFrench='' blank recto, no fail-loud (archive-page.ts); (2) detectImageExt PNG vs JPEG vs unknown-fail-loud, and a PNG master stages as .png with a matching imagePath (build.ts). Add unit tests; the fixture needs an empty-OCR option for (1) and a PNG-bytes option for (2).
<!-- SECTION:DESCRIPTION:END -->
