"""Read the official Overture release and produce a review report and optional local backfill SQL."""

import argparse
import json
import math
from pathlib import Path
import re
import struct

RELEASE = "2026-10-21.0"
DATA = f"s3://overturemaps-us-west-2/release/{RELEASE}/theme=places/type=place/*"
# Expected addresses are taken from the linked businesses, never from Google's coordinates.
# Tuples contain FoodSwipe slug, Overture name pattern, street, postal code and identity evidence.
TARGETS = [
    ("milk-burger", r"milk\s*burger", "148 Bruckner Blvd", "10454", "https://milkburger.com/order/"),
    ("emily", "emily", "919 Fulton St", "11238", "https://www.pizzalovesemily.com/location/brooklyn/"),
    ("moonburger", r"moon\s*burger", "72 Kenmare St", "10012", "https://www.moonburger.com/nolita"),
    ("deux-luxe", "deux luxe", "384 Broome St", "10012", "https://www.deuxluxeny.com/"),
    ("smacking-burger", "smacking burgers?", "51-63 8th Ave", "10014", "https://smackingburger.com/"),
    ("au-cheval", r"au cheval( nyc)?", "33 Cortlandt Alley", "10013", "https://www.auchevaldiner.com/nyc/about"),
    ("gotham-burger-social-club", r"gotham burger social club( lower east side)?", "131 Essex St", "10002",
     "https://www.gbsc.nyc/location/lower-east-side/"),
    ("minetta-tavern", "minetta tavern", "113 MacDougal St", "10012", "https://www.minettatavernny.com/hours-and-location"),
    ("7th-street-burger-east-village", r"7th street burger( east village)?", "91 E 7th St", "10009",
     "https://merch.7thstreetburger.com/pages/locations"),
    ("4-charles-prime-rib", "4 charles prime rib", "4 Charles St", "10014", "https://www.nycprimerib.com/about"),
]


def retrieve_places():
    import duckdb

    patterns = "|".join(pattern for _, pattern, *_ in TARGETS)
    with duckdb.connect(config={"threads": 4, "memory_limit": "256MB"}) as connection:
        connection.execute("INSTALL httpfs; LOAD httpfs")
        records = connection.execute("""
            SELECT id, version, names.primary AS name, ST_AsWKB(geometry) AS wkb,
                   addresses, websites, sources, operating_status, confidence
            FROM read_parquet(?, hive_partitioning = false)
            WHERE bbox.xmin BETWEEN -74.08 AND -73.82 AND bbox.ymin BETWEEN 40.62 AND 40.91
              AND regexp_full_match(lower(trim(names.primary)), ?)
        """, [DATA, f"({patterns})"])
        columns = [column[0] for column in records.description]
        return [dict(zip(columns, row)) for row in records.fetchall()]


def street_key(address):
    synonyms = {"street": "st", "avenue": "ave", "boulevard": "blvd", "east": "e"}
    return " ".join(synonyms.get(word, word) for word in re.findall(r"[a-z0-9]+", address.lower()))


def reviewed_candidates(places):
    report = []
    for slug, pattern, street, postcode, source in TARGETS:
        candidates = []
        other_addresses = set()
        for feature in places:
            if not re.fullmatch(pattern, feature["name"].strip(), re.IGNORECASE):
                continue
            addresses = feature["addresses"] or []
            matches = any(
                address.get("country") == "US"
                and (address.get("region") or "").upper() == "NY"
                and (address.get("postcode") or "")[:5] == postcode
                and street_key(address.get("freeform") or "") == street_key(street)
                for address in addresses
            )
            if not matches:
                other_addresses.update(address["freeform"] for address in addresses if address.get("freeform"))
                continue
            wkb = feature["wkb"]
            candidate = {key: value for key, value in feature.items() if key != "wkb"}
            if wkb and len(wkb) == 21 and wkb[0] in (0, 1):
                geometry, lng, lat = struct.unpack(("<" if wkb[0] == 1 else ">") + "Idd", wkb[1:])
                if geometry == 1 and math.isfinite(lng) and math.isfinite(lat):
                    candidate.update(lat=lat, lng=lng)
            candidates.append(candidate)
        candidates.sort(key=lambda place: place["id"])
        status = "missing"
        if len(candidates) > 1:
            status = "ambiguous"
        elif candidates:
            candidate = candidates[0]
            status = ("candidate" if "lat" in candidate and candidate["operating_status"] in ("open", None)
                      and candidate["sources"] else "needs_review")
        report.append(dict(slug=slug, street=street, postcode=postcode, identityEvidenceUrl=source,
                           disposition=status, candidates=candidates, excludedAddresses=sorted(other_addresses)))
    return report


def sql_text(value):
    return "'" + value.replace("'", "''") + "'"


def pending_sql(report):
    # psql exits on any error. A reserved database name provides a second guard
    # after connecting explicitly to localhost in the documented command.
    lines = [r"\set ON_ERROR_STOP on", "BEGIN;", "SET LOCAL standard_conforming_strings = on;", """
DO $guard$
BEGIN
  IF current_database() <> 'foodswipe_map_staging' OR inet_server_addr() IS NULL
      OR NOT (inet_server_addr() <<= inet '127.0.0.0/8' OR inet_server_addr() = inet '::1') THEN
    RAISE EXCEPTION 'Import requires the local foodswipe_map_staging database over loopback TCP';
  END IF;
END
$guard$;
""".strip()]
    for row in report:
        if row["disposition"] != "candidate":
            continue
        candidate = row["candidates"][0]
        evidence = {key: value for key, value in candidate.items() if key not in ("id", "version", "lat", "lng")}
        fields = [
            sql_text(candidate["id"]), sql_text(RELEASE), str(int(candidate["version"])),
            str(candidate["lat"]), str(candidate["lng"]), sql_text(json.dumps(evidence)) + "::jsonb",
            sql_text(row["identityEvidenceUrl"]),
        ]
        lines.append(f"""INSERT INTO restaurant_locations
  (restaurant_id, overture_id, release, feature_version, lat, lng, evidence, identity_evidence_url)
SELECT id, {", ".join(fields)}
FROM restaurants WHERE slug = {sql_text(row["slug"])} AND market = 'nyc' AND status = 'published'
ON CONFLICT (restaurant_id, overture_id, release) DO NOTHING;""")
    return "\n\n".join([*lines, "COMMIT;"]) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--staging-sql", type=Path, help="Write pending import SQL for a local staging database. Does not connect to PostgreSQL.")
    args = parser.parse_args()
    report = reviewed_candidates(retrieve_places())
    args.report.write_text(json.dumps({"release": RELEASE, "restaurants": report}, indent=2) + "\n", encoding="utf-8")
    if args.staging_sql:
        args.staging_sql.write_text(pending_sql(report), encoding="utf-8")
    for row in report:
        print(row["slug"], row["disposition"], len(row["candidates"]))


if __name__ == "__main__":
    main()
