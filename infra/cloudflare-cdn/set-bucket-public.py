#!/usr/bin/env python3
"""
TASK-12 step 1: flip the colony-cults B2 bucket to public-read via the B2
native API (stable, no b2 CLI needed). Reads credentials from the local creds
file -- no secrets on the command line. Prints the bucket's real downloadUrl
(so the Worker's B2_DOWNLOAD_BASE host is correct) and verifies an anonymous
read succeeds afterward.

Run it yourself:  ! python3 infra/cloudflare-cdn/set-bucket-public.py
"""
import base64
import json
import sys
import urllib.error
import urllib.request

CREDS = "/Users/orion/.config/backblaze/b2-credentials.txt"
BUCKET = "colony-cults"
SAMPLE_KEY = (
    "archive/cases/port-breton/newspapers/la-nouvelle-france/"
    "1881-04-15_bpt6k5605235w/f001.jpg"
)


def parse_creds(path):
    keyid = appkey = None
    with open(path) as f:
        for line in f:
            if ":" not in line:
                continue
            k, _, v = line.partition(":")
            k = k.strip()
            v = v.strip().strip("\t\r ")
            if k == "keyID":
                keyid = v
            elif k == "applicationKey":
                appkey = v
    if not keyid or not appkey:
        sys.exit("ERROR: could not parse keyID/applicationKey from " + path)
    return keyid, appkey


def post(url, token, data):
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode(),
        headers={"Authorization": token, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def main():
    keyid, appkey = parse_creds(CREDS)

    auth_req = urllib.request.Request(
        "https://api.backblazeb2.com/b2api/v3/b2_authorize_account"
    )
    basic = base64.b64encode(f"{keyid}:{appkey}".encode()).decode()
    auth_req.add_header("Authorization", "Basic " + basic)
    try:
        with urllib.request.urlopen(auth_req) as r:
            auth = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"ERROR: b2_authorize_account failed ({e.code}). Key invalid/rotated?")

    storage = auth["apiInfo"]["storageApi"]
    api_url = storage["apiUrl"]
    download_url = storage["downloadUrl"]
    account_id = auth["accountId"]
    token = auth["authorizationToken"]
    print(f"downloadUrl: {download_url}")

    try:
        lb = post(
            f"{api_url}/b2api/v3/b2_list_buckets",
            token,
            {"accountId": account_id, "bucketName": BUCKET},
        )
    except urllib.error.HTTPError as e:
        sys.exit(f"ERROR: b2_list_buckets failed ({e.code}); key may lack listBuckets.")
    buckets = lb.get("buckets", [])
    if not buckets:
        sys.exit(f"ERROR: bucket {BUCKET} not found for this key.")
    bucket = buckets[0]
    print(f"current bucketType: {bucket['bucketType']}  (bucketId {bucket['bucketId']})")

    if bucket["bucketType"] == "allPublic":
        print("bucket is ALREADY allPublic; no change.")
    else:
        try:
            upd = post(
                f"{api_url}/b2api/v3/b2_update_bucket",
                token,
                {
                    "accountId": account_id,
                    "bucketId": bucket["bucketId"],
                    "bucketType": "allPublic",
                },
            )
        except urllib.error.HTTPError as e:
            sys.exit(
                f"ERROR: b2_update_bucket failed ({e.code}). This key likely lacks "
                "the 'writeBuckets' capability. Use the B2 master key (or a key with "
                "writeBuckets), or flip it in the B2 console: Bucket Settings -> "
                "'Files in bucket are:' Public."
            )
        print(f"new bucketType: {upd['bucketType']}")

    test_url = f"{download_url}/file/{BUCKET}/{SAMPLE_KEY}"
    try:
        with urllib.request.urlopen(
            urllib.request.Request(test_url, method="HEAD")
        ) as r:
            print(f"anonymous HEAD: {r.status}  ({test_url})")
    except urllib.error.HTTPError as e:
        print(f"anonymous HEAD FAILED: {e.code}  ({test_url})")

    print()
    print("=> set wrangler B2_DOWNLOAD_BASE =", f"{download_url}/file/{BUCKET}")


if __name__ == "__main__":
    main()
