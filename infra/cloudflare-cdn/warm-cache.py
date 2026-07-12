#!/usr/bin/env python3
"""
TASK-12 cache warming: request every archived object once THROUGH the Worker so
it lands in Cloudflare's edge cache. A cache MISS fetches B2 (one Class B
transaction) and caches it; every later read is a free HIT that never touches
B2. Run this AFTER the B2 download cap has headroom (daily reset or a raised
cap) -- while the cap is blown, B2 returns 403 and nothing can be primed.

Object keys are read from the archive clone's per-asset provenance YAMLs
(object_store.key, which equals the archive-relative .jpg path). Stops and
reports if it starts hitting the B2 download cap (403).

Usage:
  CORPUS_ARCHIVE_PATH=/Users/orion/work/colony-cults-archive \\
  CDN_BASE=https://colony-cults-cdn.oletizi.workers.dev \\
  python3 infra/cloudflare-cdn/warm-cache.py
"""
import glob
import os
import re
import sys
import urllib.error
import urllib.request

CDN_BASE = os.environ.get(
    "CDN_BASE", "https://colony-cults-cdn.oletizi.workers.dev"
).rstrip("/")
ARCHIVE = os.environ.get(
    "CORPUS_ARCHIVE_PATH", "/Users/orion/work/colony-cults-archive"
)
KEY_RE = re.compile(r'key:\s*"(archive/[^"]+\.jpg)"')
MAX_CONSECUTIVE_403 = 5


def collect_keys():
    keys = set()
    pattern = os.path.join(ARCHIVE, "archive", "**", "*.yml")
    for yml in glob.glob(pattern, recursive=True):
        try:
            with open(yml) as f:
                for line in f:
                    m = KEY_RE.search(line)
                    if m:
                        keys.add(m.group(1))
        except OSError:
            continue
    return sorted(keys)


def main():
    keys = collect_keys()
    if not keys:
        sys.exit(
            f"No object_store keys found under {ARCHIVE}/archive -- is "
            "CORPUS_ARCHIVE_PATH the archive clone root?"
        )
    print(f"warming {len(keys)} objects through {CDN_BASE}")
    hits = misses = errors = 0
    consec_403 = 0
    for i, key in enumerate(keys, 1):
        url = f"{CDN_BASE}/{key}"
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req) as r:
                status = r.status
                cache = r.headers.get("X-CDN-Cache", "?")
        except urllib.error.HTTPError as e:
            status = e.code
            cache = e.headers.get("X-CDN-Cache", "?")
        except Exception as e:  # noqa: BLE001
            print(f"  [{i}/{len(keys)}] ERROR {key}: {e}")
            errors += 1
            continue

        if status == 200:
            consec_403 = 0
            if cache == "HIT":
                hits += 1
            else:
                misses += 1
        elif status == 403:
            consec_403 += 1
            errors += 1
            if consec_403 >= MAX_CONSECUTIVE_403:
                print(
                    f"  [{i}/{len(keys)}] {consec_403} consecutive 403s -- B2 "
                    "download cap is blown. Stop; retry after the daily reset "
                    "or raise the cap."
                )
                break
        else:
            errors += 1

        if i % 100 == 0 or status != 200:
            print(f"  [{i}/{len(keys)}] {status} {cache} {key}")

    print(
        f"\ndone: {hits} hit, {misses} newly-cached, {errors} error/403 "
        f"(of {len(keys)} keys)"
    )


if __name__ == "__main__":
    main()
