#!/usr/bin/env node

import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    help: {
      type: 'boolean',
      short: 'h',
      default: false,
    },
    version: {
      type: 'boolean',
      short: 'v',
      default: false,
    },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(`
gallica - Mirror public-domain BnF Gallica sources

Usage:
  gallica [command] [options]

Commands:
  census     Build an authoritative issue census
  fetch-issue  Fetch images for a specific issue
  fetch-source Fetch images for all issues in a source
  ocr        Run OCR on fetched images

Options:
  --help, -h     Show this help message
  --version, -v  Show version
  --dry-run      Report without writing to archive
  --force        Re-fetch even if checksums match
  --verify       Re-hash all recorded assets
  --ocr          Enable OCR pipeline

Note: This is a placeholder. Full implementation coming in Phase 2.
`);
  process.exit(0);
}

if (values.version) {
  console.log('0.1.0');
  process.exit(0);
}

console.log('gallica: use --help for usage');
