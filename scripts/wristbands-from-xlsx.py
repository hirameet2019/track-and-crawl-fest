#!/usr/bin/env python3
"""
Turn the organizer's "Remaining Tickets" workbook into SQL that loads the
pre-printed wristband serials into ticket_numbers.

Layout expected (one column per label):
  row 1  label name        e.g. "vip car display"
  row 2  band colour       e.g. "RED STRIPES"
  row 3+ serials           e.g. R067521  (letter = colour = ticket_types.code)
Cells that are not <letter><digits> (headers, "TOTAL - 180 PCS") are skipped.

Standard library only, so it runs anywhere:
  python scripts/wristbands-from-xlsx.py "<workbook.xlsx>" > supabase/data/wristbands.sql   # emit SQL
  python scripts/wristbands-from-xlsx.py "<workbook.xlsx>" --push                           # load straight into Supabase
--push reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local and
upserts through the REST API, ignoring serials that already exist.
"""
import html
import json
import os
import re
import sys
import urllib.request
import zipfile
from collections import Counter

COLOUR_LETTER = {"blue": "B", "yellow": "Y", "orange": "O", "red": "R", "pink": "P", "green": "G"}
SERIAL = re.compile(r"^([A-Z])(\d+)$")


def load_cells(path):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        s = z.read("xl/sharedStrings.xml").decode("utf8")
        shared = [html.unescape("".join(re.findall(r"<t[^>]*>([^<]*)</t>", si))) for si in re.findall(r"<si>(.*?)</si>", s, re.S)]
    sheet = sorted(n for n in z.namelist() if n.startswith("xl/worksheets/sheet"))[0]
    x = z.read(sheet).decode("utf8")
    cells = {}  # (col, row) -> text
    for m in re.finditer(r'<c r="([A-Z]+)(\d+)"([^>]*?)(?:/>|>(.*?)</c>)', x, re.S):
        col, row, attrs, inner = m.group(1), int(m.group(2)), m.group(3), m.group(4) or ""
        v = re.search(r"<v>([^<]*)</v>", inner)
        isv = re.search(r"<is>.*?<t[^>]*>([^<]*)</t>", inner, re.S)
        if v:
            val = v.group(1)
            if 't="s"' in attrs:
                val = shared[int(val)]
        elif isv:
            val = isv.group(1)
        else:
            continue
        cells[(col, row)] = html.unescape(val).strip()
    return cells


def read_env(path=".env.local"):
    env = dict(os.environ)
    if os.path.exists(path):
        for line in open(path, encoding="utf8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env.setdefault(k.strip(), v.strip().strip('"'))
    return env


def push(groups):
    """groups: {letter: [serials in order]} -> upsert into ticket_numbers via PostgREST."""
    env = read_env()
    url, key = env.get("NEXT_PUBLIC_SUPABASE_URL"), env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (.env.local)")
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    def call(method, path, body=None, extra=None):
        req = urllib.request.Request(url + "/rest/v1/" + path, method=method, headers={**headers, **(extra or {})},
                                     data=json.dumps(body).encode() if body is not None else None)
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or b"null")

    def count(type_id):
        # HEAD with count=exact returns "0-999/652" style Content-Range; the total is after the slash.
        req = urllib.request.Request(url + f"/rest/v1/ticket_numbers?select=id&ticket_type_id=eq.{type_id}", method="HEAD",
                                     headers={**headers, "Prefer": "count=exact", "Range-Unit": "items", "Range": "0-0"})
        with urllib.request.urlopen(req) as r:
            return int(r.headers["Content-Range"].split("/")[-1])

    types = {t["code"]: t["id"] for t in call("GET", "ticket_types?select=id,code")}
    for letter, serials in groups.items():
        if letter not in types:
            sys.exit(f"no ticket type with code {letter}; run the migration first")
        rows = [{"ticket_type_id": types[letter], "number": s, "seq": i} for i, s in enumerate(serials, start=1)]
        before = count(types[letter])
        for i in range(0, len(rows), 1000):
            call("POST", "ticket_numbers?on_conflict=ticket_type_id,number", rows[i:i + 1000],
                 extra={"Prefer": "resolution=ignore-duplicates,return=minimal"})
        after = count(types[letter])
        print(f"  {letter}: {len(serials)} in sheet, {after - before} inserted, {after} now in pool", file=sys.stderr)


def main(path, do_push=False):
    cells = load_cells(path)
    cols = sorted({c for c, _ in cells}, key=lambda c: (len(c), c))
    out = []
    summary = []
    seen_all = Counter()
    groups = {}
    for col in cols:
        header = cells.get((col, 1), "")
        colour = cells.get((col, 2), "").lower()
        letter = next((L for name, L in COLOUR_LETTER.items() if name in colour), None)
        rows = sorted(r for c, r in cells if c == col and r >= 3)
        serials = []
        for r in rows:
            m = SERIAL.match(cells[(col, r)].replace(" ", ""))
            if m:
                serials.append(m.group(0))
        if not serials or not letter:
            continue  # notes/legend columns
        bad = [s for s in serials if s[0] != letter]
        if bad:
            sys.exit(f"column {col} ({header}): serial letter does not match colour {colour}: {bad[:5]}")
        dup = [s for s, n in Counter(serials).items() if n > 1]
        if dup:
            sys.exit(f"column {col} ({header}): duplicate serials {dup[:5]}")
        seen_all.update(serials)
        groups[letter] = serials
        values = ",\n".join(f"  ('{s}', {i})" for i, s in enumerate(serials, start=1))
        out.append(
            f"-- {header} / {colour} : {len(serials)} serials, {serials[0]}..{serials[-1]}\n"
            f"insert into ticket_numbers (ticket_type_id, number, seq)\n"
            f"select tt.id, v.number, v.seq\n"
            f"from ticket_types tt join events e on e.id = tt.event_id and e.active,\n"
            f"(values\n{values}\n) as v(number, seq)\n"
            f"where tt.code = '{letter}'\n"
            f"on conflict (ticket_type_id, number) do nothing;\n"
        )
        summary.append((col, header, colour, letter, len(serials), serials[0], serials[-1]))
    cross = [s for s, n in seen_all.items() if n > 1]
    if cross:
        sys.exit(f"serials appear in more than one column: {cross[:5]}")
    if do_push:
        for col, header, colour, letter, n, first, last in summary:
            print(f"{col}: code {letter}  {n:>5}  {first}..{last}  ({header} / {colour})", file=sys.stderr)
        print("pushing to Supabase...", file=sys.stderr)
        push(groups)
        return
    print("-- Generated by scripts/wristbands-from-xlsx.py. Do not edit by hand.")
    print("-- Source: " + path)
    for col, header, colour, letter, n, first, last in summary:
        print(f"--   {col}: code {letter}  {n:>5}  {first}..{last}  ({header} / {colour})")
    print()
    print("\n".join(out))


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        sys.exit(__doc__)
    main(args[0], do_push="--push" in sys.argv)
