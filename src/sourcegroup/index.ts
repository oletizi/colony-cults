/**
 * Source Group Member-Acquisition Pipeline
 *
 * This module implements a reusable pipeline for acquiring members into a source group:
 * Discover → Inventory → Repository-Verification → Promote → Acquire → Preserve
 *
 * The pipeline operates over the canonical metadata model (Source, Repository Record,
 * Asset) and manages the lifecycle of source group membership, from discovery of new
 * candidates through acquisition and preservation in the archive.
 *
 * @see src/model for the canonical data structures
 * @see src/bibliography for validation and metadata utilities
 */
