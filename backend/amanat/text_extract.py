"""Turn an uploaded file into plain text."""
import io

from pypdf import PdfReader


def extract_text(filename: str, data: bytes) -> str:
    name = filename.lower()
    if name.endswith(".pdf") or data[:5] == b"%PDF-":
        reader = PdfReader(io.BytesIO(data))
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n".join(pages).strip()
    # .txt / .csv and anything else text-like
    return data.decode("utf-8", errors="replace").strip()


def is_pdf(filename: str, data: bytes) -> bool:
    return filename.lower().endswith(".pdf") or data[:5] == b"%PDF-"
