"""
Builds server/data/almanac-taxonomy.json from a curated species list, with the
metadata for each species read out of the published Singapore flora checklist.

    Chong, K. Y., Tan, H. T. W. & Corlett, R. T. (2009).
    A Checklist of the Total Vascular Plant Flora of Singapore:
    Native, Naturalised and Cultivated Species.
    Raffles Museum of Biodiversity Research, National University of Singapore.

    python3 -m venv .venv && .venv/bin/pip install pypdf
    .venv/bin/python scripts/extract-flora-checklist.py path/to/checklist.pdf

The PDF holds the same ~4,190 species three times over, as three tables with
different final columns: status (pp. 13-95), origin (pp. 96-190) and growth form
(pp. 191-277). Every row reads `N. Species Authority; Family; value`, so the
three are parsed separately and joined on the binomial.

WHICH SPECIES
-------------
The list is `scripts/almanac-curated.json` — 50 plants a person in Singapore
can name on sight. Edit that file to change the almanac; this script only looks
their details up.

It used to select mechanically instead: keep the common/naturalised/casual
species, drop the ferns, then round-robin across families to 200. That produced
an almanac nobody could recognise. Two rules did the damage.

`cultivated only` excluded 1,491 species, which is where bougainvillea,
frangipani, flame of the forest and the whole of Nyctaginaceae live — in
Singapore they are roadside and garden planting, so a checklist of wild and
naturalised flora rightly calls them cultivated, and a game about plants people
walk past rightly wants them. `weed of uncertain origin` excluded another 208,
including lalang and kangkong.

The round-robin then sorted alphabetically twice over — species within a family,
and families within each depth — so with 120 families and 200 slots the third
slot reached only `Acanthaceae` through `Chrysobalanaceae`. Half the almanac was
genera starting A-E. Fabaceae, one of the largest families here, got two slots,
and they went to Archidendron and Canavalia; Mimosa pudica was in the candidate
pool the whole time and never had a chance against the letter A.

Curating 50 does the job the status filter was reaching for — an almanac you can
finish — directly, and without pretending the selection is derived from the
source when the recognisability judgement is ours.

PROVENANCE
----------
Every row's family, status, origin and growth form is read from the checklist,
so nothing here is invented. The exception is a row marked `"cultivar": true`,
which carries its own: Vanda Miss Joaquim is a man-made hybrid
(Papilionanthe Miss Joaquim) and a checklist of species has no entry for it.
Those rows are stamped `source: "cultivar"`; everything else is
`source: "checklist"`.

Common names are not in the source either. They are part of the curated list,
which is why all 50 have one where the old generated 200 managed 68.
"""
import json
import os
import re
import sys

STATUS_PAGES = (12, 94)
ORIGIN_PAGES = (95, 189)
FORM_PAGES = (190, 276)

CURATED_PATH = os.path.join(os.path.dirname(__file__), "almanac-curated.json")

# The extractor splits a handful of words across a line break.
REPAIRS = {"exo tic": "exotic", "nativ e": "native", "na tive": "native"}
ENTRY = re.compile(r"^\s*(\d{1,4})\.\s+(.*)$")
# Table values carry the paper's footnote markers — `vulnerable o`, `common q`.
# The old selector matched statuses exactly, so every footnoted row silently
# failed the filter and dropped out of the pool; ~7 species were excluded from
# the almanac by a typographic detail rather than by any rule.
FOOTNOTE = re.compile(r" [a-z]$")


def clean(value):
    """A table value with its footnote marker and line-break damage removed."""
    value = REPAIRS.get(value, value)
    return FOOTNOTE.sub("", value).strip()


def read_table(reader, first_page, last_page):
    """Rows of `(name, family, value)`, rejoining entries split over lines."""
    bodies, current = [], None
    for index in range(first_page, last_page + 1):
        for line in (reader.pages[index].extract_text() or "").split("\n"):
            match = ENTRY.match(line)
            if match:
                if current:
                    bodies.append(current)
                current = match.group(2).strip()
            elif current and line.strip() and not line.strip().isdigit():
                if "Checklist of the Total" in line or line.strip() == "Chong et al.":
                    continue  # running header
                current = f"{current} {line.strip()}"
    if current:
        bodies.append(current)

    rows = []
    for body in bodies:
        parts = [part.strip() for part in body.split(";")]
        if len(parts) >= 3:
            rows.append((parts[0], parts[1], parts[2].lower()))
    return rows


def binomial(name):
    """Genus + epithet, dropping the authority and any infraspecific rank."""
    return " ".join(name.replace("×", "x ").split()[:2])


def main(pdf_path, output_path):
    from pypdf import PdfReader

    with open(CURATED_PATH) as handle:
        curated = json.load(handle)["species"]

    reader = PdfReader(pdf_path)
    # Later rows win on a duplicate binomial, which only affects the three
    # species listed twice in the source; the values agree in every case.
    status = {binomial(n): (f, clean(v)) for n, f, v in read_table(reader, *STATUS_PAGES)}
    origin = {binomial(n): clean(v) for n, _, v in read_table(reader, *ORIGIN_PAGES)}
    form = {binomial(n): clean(v) for n, _, v in read_table(reader, *FORM_PAGES)}

    rows, missing = [], []
    for entry in curated:
        name = entry["speciesName"]

        if entry.get("cultivar"):
            # Carries its own metadata: the checklist has no row to read.
            rows.append({
                "id": name.lower().replace(" ", "-"),
                "speciesName": name,
                "family": entry["family"],
                "commonName": entry["commonName"],
                "status": entry["status"],
                "origin": entry.get("origin"),
                "growthForm": entry.get("growthForm"),
                "source": "cultivar",
            })
            continue

        if name not in status:
            missing.append(name)
            continue

        family, state = status[name]
        rows.append({
            "id": name.lower().replace(" ", "-"),
            "speciesName": name,
            "family": family,
            "commonName": entry["commonName"],
            "status": state,
            "origin": origin.get(name) or None,
            # `herb weed`, `shrub weed` and friends name a habit plus a
            # judgement; the almanac wants the habit.
            "growthForm": (form.get(name) or "").split(" weed")[0] or None,
            "source": "checklist",
        })

    if missing:
        # Loudly, and without writing: a curated name that does not resolve is
        # a typo or a synonym the checklist files elsewhere, and silently
        # dropping it would shrink the almanac without saying so.
        sys.exit(
            f"{len(missing)} curated species are not in the checklist:\n  "
            + "\n  ".join(missing)
            + "\n\nFix the name in almanac-curated.json, or mark the row "
              '"cultivar": true and give it its own family/status/origin/growthForm.'
        )

    duplicates = {row["id"] for row in rows if [r["id"] for r in rows].count(row["id"]) > 1}
    if duplicates:
        sys.exit(f"duplicate species in the curated list: {', '.join(sorted(duplicates))}")

    with open(output_path, "w") as handle:
        json.dump(rows, handle, indent=2)
        handle.write("\n")

    named = sum(1 for row in rows if row["commonName"])
    cultivars = sum(1 for row in rows if row["source"] == "cultivar")
    print(
        f"wrote {len(rows)} species to {output_path} "
        f"({named} with a common name, {len(rows) - cultivars} from the checklist, "
        f"{cultivars} hand-written)"
    )


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: extract-flora-checklist.py <checklist.pdf> [output.json]")
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "server/data/almanac-taxonomy.json")
