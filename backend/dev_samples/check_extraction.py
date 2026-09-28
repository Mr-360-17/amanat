"""Run the configured extractor on the 5 synthetic PDFs and compare with Ramesh's dataset.
Also fills the cache, so run this during rehearsal. From backend/:
    python dev_samples/check_extraction.py"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from amanat import config  # noqa: E402
from amanat.extractors import extract_document  # noqa: E402

PDFS = Path(__file__).resolve().parent / "pdfs"
EXPECTED = {
    "sbi_savings_statement.pdf": ("Savings Account", 145000, "Sunita Kumar"),
    "sbi_fd_receipt.pdf": ("Fixed Deposit", 500000, None),
    "lic_policy_bond.pdf": ("Life Insurance", 1000000, "Sunita Kumar"),
    "epf_passbook.pdf": ("EPF", 320000, "Sunita Kumar"),
    "hdfc_mf_statement.pdf": ("Mutual Fund", 180000, "Rahul Kumar"),
}

print("provider:", config.resolve_provider())
passed = 0
for name, (atype, value, nominee) in EXPECTED.items():
    t0 = time.time()
    r = extract_document(name, (PDFS / name).read_bytes())
    dt = time.time() - t0
    a = r["assets"]
    ok = (len(a) == 1 and a[0]["asset_type"] == atype and a[0]["value"] == value
          and (a[0].get("nominee") or None) == nominee)
    passed += ok
    print(f"{name:28} by={r['extracted_by']:13} {dt:5.1f}s  {'PASS' if ok else 'CHECK'}"
          + (f"  note={r['note']}" if r["note"] else ""))
    if ok:
        print(f"    {a[0]['institution']} | {a[0]['account_number']} | {a[0]['owner']} | nominee: {a[0]['nominee']}")
    else:
        print("    got:", json.dumps(a))
print(f"\n{passed}/{len(EXPECTED)} match the agreed dataset")
