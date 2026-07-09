/**
 * Canonical set of image-master gitignore patterns for the archive
 * worktree.
 *
 * This is the single source of truth for the go-forward-only image-master
 * ignores required by FR-005/FR-013: archive page-image masters (.jpg,
 * .jpeg, .png under archive/cases/**) must never be tracked in git, since
 * they live in the object store instead. The archive worktree's real
 * `.gitignore` (maintained per T002 setup) MUST contain these patterns.
 *
 * Tests import this constant (rather than hardcoding a copy of the
 * patterns) so they can never drift from what the product considers
 * canonical.
 */
export const IMAGE_MASTER_GITIGNORE_PATTERNS: readonly string[] = [
  'archive/cases/**/*.jpg',
  'archive/cases/**/*.jpeg',
  'archive/cases/**/*.png',
];
