"""Make an image-only ("scanned") version of the SBI FD receipt: no text layer, slightly
rotated and noisy, like a phone scan. Tests that Gemini/Claude can read scans.
Run:  python dev_samples/make_scanned.py   (from backend/)"""
import random
from pathlib import Path

from fpdf import FPDF
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# Kept out of pdfs/ so it isn't part of the live-upload demo set (it duplicates the FD).
OUT = Path(__file__).resolve().parent / "scans"
LINES = [
    ("STATE BANK OF INDIA", 44, True),
    ("Fixed Deposit Advice / Receipt", 30, False),
    ("SYNTHETIC SAMPLE - NOT A REAL DOCUMENT", 24, False),
    ("", 20, False),
    ("Depositor Name : Ramesh Kumar", 30, False),
    ("FD Number : 30556781234", 30, False),
    ("Deposit Amount : INR 5,00,000.00", 30, False),
    ("Rate of Interest : 6.80% p.a.", 30, False),
    ("Date of Deposit : 12-01-2025", 30, False),
    ("Maturity Date : 12-01-2028", 30, False),
    ("Nominee : Not Registered", 30, False),
]


def _font(size: int, bold: bool):
    for name in (("arialbd.ttf" if bold else "arial.ttf"), "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main() -> Path:
    random.seed(7)
    img = Image.new("L", (1240, 1754), 247)  # A4 at 150 dpi, off-white paper
    draw = ImageDraw.Draw(img)
    y = 120
    for text, size, bold in LINES:
        draw.text((110, y), text, fill=25, font=_font(size, bold))
        y += int(size * 1.9)
    for _ in range(2500):  # scanner speckle
        draw.point((random.randrange(img.width), random.randrange(img.height)), fill=random.randint(150, 215))
    img = img.rotate(1.2, fillcolor=247, resample=Image.BICUBIC).filter(ImageFilter.GaussianBlur(0.6))

    OUT.mkdir(parents=True, exist_ok=True)
    png = OUT / "_scan.png"
    img.save(png)
    pdf = FPDF(format="A4")
    pdf.add_page()
    pdf.image(str(png), x=0, y=0, w=210, h=297)
    out = OUT / "sbi_fd_receipt_scanned.pdf"
    pdf.output(str(out))
    png.unlink()
    print("wrote", out)
    return out


if __name__ == "__main__":
    main()
