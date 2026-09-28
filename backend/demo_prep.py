"""One command before every rehearsal and before the real demo.

    python demo_prep.py              # empty vault: demo starts with the live upload
    python demo_prep.py --loaded     # Ramesh's data preloaded: rehearse later screens
    python demo_prep.py --pdfs <dir> # use Unnati's final demo PDFs instead of dev samples
    python demo_prep.py --no-warm    # don't call the AI at all (saves free-tier quota)

It (1) checks the backend is running, (2) makes sure every demo PDF is cached from the AI
so the live upload is instant and works offline, (3) resets the server to a known state,
and (4) prints a go / no-go checklist. Run from backend/ with the server already started
(run_lan.ps1)."""
import argparse
import hashlib
import sys
from pathlib import Path

import httpx

BACKEND = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND))

from amanat import config  # noqa: E402
from amanat.extractors import _read_cache, extract_document  # noqa: E402
from amanat.extractors.llm import PROVIDERS  # noqa: E402
from amanat.text_extract import extract_text  # noqa: E402


def inr(amount: float) -> str:
    """21,45,000 style (Indian digit grouping)."""
    s = f"{int(round(amount))}"
    if len(s) <= 3:
        return s
    head, tail = s[:-3], s[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    return ",".join(([head] if head else []) + groups) + "," + tail

OK, WARN, BAD = "  [ OK ]", "  [WARN]", "  [FAIL]"


def check_server(url: str) -> dict | None:
    try:
        r = httpx.get(f"{url}/health", timeout=5)
        r.raise_for_status()
        return r.json()
    except httpx.HTTPError:
        return None


def warm_cache(pdfs: list[Path], do_warm: bool) -> list[tuple[str, str, str]]:
    """Returns (file, status, detail) per PDF. status: cached | warmed | rules | failed."""
    provider = config.resolve_provider()
    rows = []
    for pdf in pdfs:
        data = pdf.read_bytes()
        cached_by, cached = _read_cache(hashlib.sha256(data).hexdigest(), provider)
        if cached is not None:
            rows.append((pdf.name, "cached", f"{len(cached)} asset(s), from {cached_by}"))
            continue
        if not do_warm or provider not in PROVIDERS:
            if not extract_text(pdf.name, data):
                rows.append((pdf.name, "failed", "scanned PDF not cached; a live upload finds nothing "
                                                 "if the AI is busy. Re-run without --no-warm"))
            else:
                rows.append((pdf.name, "rules", "not cached; live upload will use the rule-based extractor"))
            continue
        print(f"    asking {provider} about {pdf.name} ...", flush=True)
        r = extract_document(pdf.name, data)
        if r["extracted_by"] == provider:
            rows.append((pdf.name, "warmed", f"{len(r['assets'])} asset(s), now cached"))
        elif r["assets"]:
            rows.append((pdf.name, "rules", f"AI unavailable; rules found {len(r['assets'])} asset(s)"))
        else:
            rows.append((pdf.name, "failed", r["note"] or "nothing extracted"))
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="http://localhost:8000")
    ap.add_argument("--pdfs", type=Path, default=BACKEND / "dev_samples" / "pdfs")
    ap.add_argument("--loaded", action="store_true", help="preload Ramesh's dataset after reset")
    ap.add_argument("--no-warm", action="store_true", help="don't call the AI to fill the cache")
    args = ap.parse_args()

    print("\nAmanat demo prep\n")
    problems = 0

    health = check_server(args.url)
    if health is None:
        print(f"{BAD} backend not reachable at {args.url}. Start it with run_lan.ps1 first.")
        return 1
    print(f"{OK} backend running at {args.url} (AI: {health['llm_provider']})")

    pdfs = sorted(p for p in args.pdfs.glob("*.pdf"))
    if not pdfs:
        print(f"{BAD} no PDFs in {args.pdfs}")
        return 1
    print(f"\n  Demo PDFs ({args.pdfs}):")
    for name, status, detail in warm_cache(pdfs, not args.no_warm):
        tag = {"cached": OK, "warmed": OK, "rules": WARN, "failed": BAD}[status]
        problems += status == "failed"
        print(f"{tag} {name}: {detail}")

    print()
    httpx.post(f"{args.url}/demo/reset", timeout=10).raise_for_status()
    if args.loaded:
        s = httpx.post(f"{args.url}/demo/load", timeout=10).json()
        print(f"{OK} reset + loaded Ramesh: {s['asset_count']} assets, Rs {inr(s['total_value'])}, "
              f"circle {s['circle']['accepted']}/{s['circle']['total']} accepted")
    else:
        print(f"{OK} reset: vault empty, ready for the live upload")

    parts = [("Keeper agent (Pratham)", health["keeper_connected"]),
             ("Claim agent (Unnati)", health["claims_agent_connected"])]
    for label, connected in parts:
        print(f"{OK if connected else WARN} {label}: {'connected' if connected else 'not connected, using mocks'}")

    print("\n  " + ("GO: ready for the demo." if problems == 0 else f"NO-GO: {problems} problem(s) above.") + "\n")
    return 0 if problems == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
