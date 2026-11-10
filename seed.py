#!/usr/bin/env python3
"""Generate labelled, synthetic quote-request emails for the quote intake demo.

Each sample is a made-up customer email plus the answer a careful person would give
(the "truth"): customer, contact, items, needed-by date, PO, ship-to, and whether the
request is ready to quote. The page runs a rules-based reader over these and measures
how often it agrees.

Usage:  python3 seed.py OUTPUT_JSON
All customers, contacts, SKUs and numbers are invented. Seeded, so output is repeatable.
"""
import json
import random
import sys
from datetime import date, timedelta
from pathlib import Path

SEED = 11
DEMO_TODAY = date(2025, 11, 3)
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August",
               "September", "October", "November", "December"]

# sku, name, minimum order quantity, lead time in days
CATALOGUE = [
    ("BRK-100", "Steel bracket, small", 100, 7),
    ("BRK-200", "Steel bracket, large", 50, 7),
    ("PNL-310", "Enclosure panel", 10, 14),
    ("FRM-420", "Mounting frame", 5, 14),
    ("HNG-150", "Heavy-duty hinge", 25, 10),
    ("CVR-260", "Access cover", 20, 10),
    ("RCK-540", "Rack rail set", 4, 21),
    ("SHD-330", "Machine guard", 2, 21),
]
BY_SKU = {c[0]: c for c in CATALOGUE}
CONTACTS = ["Pat", "Dana", "Sam", "Alex", "Jordan", "Chris", "Morgan", "Taylor", "Riley", "Casey"]
CITIES = ["Windsor", "Barrie", "Kingston", "London", "Guelph", "Sarnia"]
NUMBER_WORDS = {50: "fifty", 100: "one hundred", 200: "two hundred", 250: "two hundred fifty",
                20: "twenty", 12: "a dozen", 24: "two dozen", 40: "forty", 10: "ten", 25: "twenty five"}

# Rules shared with the reader (the page applies the same checks to what it extracts).
def decide(customer, items, needed_by):
    reasons = []
    if not customer:
        reasons.append("customer")
    if not items:
        reasons.append("items")
    lead = 0
    for sku, qty in items:
        if sku not in BY_SKU:
            reasons.append(f"unknown_sku:{sku}")
            continue
        lead = max(lead, BY_SKU[sku][3])
        if qty is None:
            reasons.append(f"quantity:{sku}")
        elif qty < BY_SKU[sku][2]:
            reasons.append(f"below_minimum:{sku}")
    if not needed_by:
        reasons.append("needed_by")
    elif date.fromisoformat(needed_by) < DEMO_TODAY + timedelta(days=lead):
        reasons.append("too_soon")
    return ("ready_to_quote" if not reasons else "follow_up"), reasons


def fmt_date(d, rng, style):
    if style == "iso":
        return d.isoformat()
    if style == "mon_d":
        return f"{MONTHS[d.month - 1]} {d.day}"
    if style == "d_mon":
        return f"{d.day} {MONTHS[d.month - 1]}"
    if style == "long":
        return f"{MONTHS_LONG[d.month - 1]} {d.day}"
    if style == "d_slash":  # day/month: ambiguous, a known weak spot
        return f"{d.day}/{d.month}"
    raise ValueError(style)


def qty_text(qty, rng, tricky):
    if tricky:
        r = rng.random()
        if qty in NUMBER_WORDS and r < 0.45:
            return NUMBER_WORDS[qty]
        if qty >= 1000 and r < 0.8:
            return f"{qty:,}" if r < 0.5 else f"{qty // 1000}k"
    return f"{qty:,}" if qty >= 1000 and rng.random() < 0.5 else str(qty)


def make_items(rng, category):
    n = rng.choice([1, 1, 2, 2, 3])
    skus = rng.sample([c[0] for c in CATALOGUE], n)
    items = []
    for sku in skus:
        moq = BY_SKU[sku][2]
        base = rng.choice([moq, moq * 2, moq * 3, moq * 5, moq * 10])
        qty = int(base)
        items.append([sku, qty])
    return items


def build(rng, idx, category):
    customer_n = rng.randint(1, 24)
    customer = f"Customer {customer_n:02d}"
    contact = rng.choice(CONTACTS)
    items = make_items(rng, category)
    lead = max(BY_SKU[s][3] for s, _ in items)
    # Needed-by: mostly feasible, sometimes too soon.
    if rng.random() < 0.8:
        needed = DEMO_TODAY + timedelta(days=lead + rng.randint(3, 40))
    else:
        needed = DEMO_TODAY + timedelta(days=rng.randint(2, max(3, lead - 2)))
    po = f"{rng.randint(10000, 99999)}" if rng.random() < 0.6 else None
    ship_to = rng.choice(CITIES) if rng.random() < 0.6 else None
    asap = False
    tricky = category == "tricky"

    # Incomplete requests drop something on purpose.
    if category == "incomplete":
        what = rng.choice(["date", "date", "qty", "customer", "unknown_sku", "asap"])
        if what == "date":
            needed = None
        elif what == "asap":
            needed, asap = None, True
        elif what == "customer":
            customer, contact_sig = None, True
        elif what == "qty":
            items[0][1] = None
        elif what == "unknown_sku":
            items[0][0] = rng.choice(["BRK-250", "PNL-999", "HNG-175"])
    else:
        what = None

    date_style = rng.choice(["iso", "mon_d", "d_mon", "long"] + (["d_slash"] if tricky else []))
    lower_sku = category in ("informal", "tricky") and rng.random() < 0.5

    def sku_text(sku):
        return sku.lower() if lower_sku else sku

    def item_text(sku, qty):
        if qty is None:
            return f"some {sku_text(sku)}"
        q = qty_text(qty, rng, tricky)
        if tricky and rng.random() < 0.35:
            return f"{sku_text(sku)} x {q}"
        form = rng.choice([f"{q} x {sku_text(sku)}", f"{q} pcs of {sku_text(sku)}",
                           f"{q} units {sku_text(sku)}", f"{sku_text(sku)} - {q} units"])
        return form

    parts = [item_text(s, q) for s, q in items]
    if category == "clean":
        lines = [rng.choice(["Hello,", "Hello team,", "Hi,"]), "",
                 f"Please quote the following" + (f" for {customer}:" if customer else ":")]
        lines += [f"- {p}" for p in parts]
        lines.append("")
        tail = []
        if needed:
            tail.append(f"Needed by {fmt_date(needed, rng, date_style)}.")
        if ship_to:
            tail.append(f"Ship to our {ship_to} plant.")
        if po:
            tail.append(f"PO {po}." if rng.random() < 0.6 else f"Purchase order {po}.")
        elif rng.random() < 0.5:
            tail.append("PO to follow.")
        lines.append(" ".join(tail))
        lines += ["", rng.choice(["Thanks,", "Regards,", "Cheers,"]), contact]
    else:
        joiner = rng.choice([", ", " and ", "; "])
        body = rng.choice(["need a price on", "can you quote", "looking for pricing on", "rfq:", "quote pls -"])
        text = f"{body} {joiner.join(parts)}"
        bits = []
        if needed:
            bits.append(rng.choice(["by", "need by", "required before", "delivery by"]) + " " + fmt_date(needed, rng, date_style))
        elif asap:
            bits.append(rng.choice(["ASAP", "urgent", "rush please"]))
        if customer:
            bits.append(customer)
        if ship_to:
            bits.append(f"ship to {ship_to.lower() if lower_sku else ship_to}")
        if po:
            bits.append(rng.choice([f"PO {po}", f"P.O. #{po}", f"po {po}"]))
        rng.shuffle(bits)
        lines = [rng.choice(["hey -", "hi,", "hello,", ""]) + " " + text + ". " + ", ".join(bits) + ".",
                 rng.choice(["thx", "thanks", "cheers", "ty"]) + ", " + contact.lower() if lower_sku else rng.choice(["Thanks", "Cheers"]) + ", " + contact]
    text = "\n".join(lines).strip()

    needed_iso = needed.isoformat() if needed else None
    truth_items = [{"sku": s, "qty": q} for s, q in items]
    decision, reasons = decide(customer, [(s, q) for s, q in items], needed_iso)
    return {
        "id": f"R{idx:03d}",
        "category": category,
        "text": text,
        "truth": {
            "customer": customer,
            "contact": contact,
            "items": truth_items,
            "needed_by": needed_iso,
            "asap": asap,
            "po": po,
            "ship_to": ship_to,
            "decision": decision,
            "reasons": reasons,
        },
    }


# Hand-written requests that a rules-based reader gets wrong without noticing. They are not part of
# the 80 measured samples: they exist to show the limits next to the score.
WEAK_SPOTS = [
    {
        "id": "W1",
        "title": "A product mentioned, but not requested",
        "text": "Hi, can you quote 250 x BRK-200 for Customer 07? Need by Dec 12. Last time we also bought 40 x PNL-310 but not this time.\nThanks,\nDana",
        "what_a_person_sees": "Only BRK-200 is being requested. PNL-310 is a remark about a past order.",
    },
    {
        "id": "W2",
        "title": "A correction later in the message",
        "text": "Please quote 250 x BRK-200 for Customer 07, needed by Dec 12.\nCorrection: make that 300 x BRK-200.\nThanks,\nDana",
        "what_a_person_sees": "The quantity is now 300, not 250.",
    },
    {
        "id": "W3",
        "title": "A purchase order the customer wants cancelled",
        "text": "Customer 07 needs 250 x BRK-200 by Dec 12. Ship to Windsor. Please cancel the PO 44712 we sent earlier and use PO 55120.\nThanks,\nDana",
        "what_a_person_sees": "The PO to use is 55120. 44712 is the one being cancelled.",
    },
]


def main(out_path):
    rng = random.Random(SEED)
    plan = ["clean"] * 28 + ["informal"] * 24 + ["tricky"] * 16 + ["incomplete"] * 12
    rng.shuffle(plan)
    samples = [build(rng, i + 1, cat) for i, cat in enumerate(plan)]
    out = {
        "about": "Synthetic data, seed %d. Generated by seed.py." % SEED,
        "demo_today": DEMO_TODAY.isoformat(),
        "catalogue": [{"sku": s, "name": n, "min_qty": m, "lead_days": l} for s, n, m, l in CATALOGUE],
        "samples": samples,
        "weak_spots": WEAK_SPOTS,
    }
    Path(out_path).write_text(json.dumps(out, indent=1))
    counts = {}
    for s in samples:
        k = s["truth"]["decision"]
        counts[k] = counts.get(k, 0) + 1
    print(f"wrote {out_path}: {len(samples)} samples; truth decisions {counts}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: seed.py OUTPUT_JSON")
    main(sys.argv[1])
