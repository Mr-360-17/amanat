"""Generate synthetic test PDFs for Ramesh's 5 demo assets (dev fixtures only).

Every number here is fake. Unnati owns the final demo documents; these exist so the
extraction pipeline can be built and tested from hour 1.
Run:  python dev_samples/make_samples.py   (from backend/)"""
from pathlib import Path

from fpdf import FPDF

OUT = Path(__file__).resolve().parent / "pdfs"
BANNER = "SYNTHETIC SAMPLE - NOT A REAL DOCUMENT"


def _doc(title: str, subtitle: str) -> FPDF:
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, title, new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, subtitle, new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(200, 0, 0)
    pdf.cell(0, 6, BANNER, new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(0, 0, 0)
    pdf.ln(4)
    return pdf


def _fields(pdf: FPDF, rows: list[tuple[str, str]]):
    pdf.set_font("Helvetica", "", 11)
    for k, v in rows:
        pdf.cell(0, 7, f"{k}: {v}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)


def _table(pdf: FPDF, header: list[str], rows: list[list[str]], widths: list[int]):
    pdf.set_font("Helvetica", "B", 9)
    for h, w in zip(header, widths):
        pdf.cell(w, 7, h, border=1)
    pdf.ln()
    pdf.set_font("Helvetica", "", 9)
    for r in rows:
        for c, w in zip(r, widths):
            pdf.cell(w, 7, c, border=1)
        pdf.ln()
    pdf.ln(3)


def sbi_savings():
    pdf = _doc("State Bank of India", "Statement of Account - Savings Bank A/c")
    _fields(pdf, [
        ("Account Holder", "MR. RAMESH KUMAR"),
        ("Account Number", "30112284821"),
        ("Account Type", "Savings Bank A/c"),
        ("Branch", "Jayanagar, Bengaluru"),
        ("IFSC", "SBIN0000000"),
        ("Nominee", "Sunita Kumar (Wife)"),
        ("Period", "01-08-2026 to 31-08-2026"),
    ])
    _table(pdf, ["Date", "Description", "Withdrawal", "Deposit", "Balance"], [
        ["01-08-2026", "Opening Balance", "", "", "1,38,250.00"],
        ["03-08-2026", "LIC PREMIUM ECS", "4,850.00", "", "1,33,400.00"],
        ["05-08-2026", "SALARY CREDIT", "", "62,000.00", "1,95,400.00"],
        ["10-08-2026", "MF SIP HDFC MUTUAL FUND", "5,000.00", "", "1,90,400.00"],
        ["18-08-2026", "RENT TRANSFER", "45,400.00", "", "1,45,000.00"],
    ], [28, 70, 30, 30, 32])
    _fields(pdf, [("Closing Balance", "Rs. 1,45,000.00")])
    return pdf, "sbi_savings_statement.pdf"


def sbi_fd():
    pdf = _doc("STATE BANK OF INDIA", "Fixed Deposit Advice / Receipt")
    _fields(pdf, [
        ("Depositor Name", "Ramesh Kumar"),
        ("FD Number", "30556781234"),
        ("Deposit Amount", "INR 5,00,000.00"),
        ("Rate of Interest", "6.80% p.a."),
        ("Date of Deposit", "12-01-2025"),
        ("Maturity Date", "12-01-2028"),
        ("Maturity Value", "INR 6,12,408.00"),
        ("Nominee", "Not Registered"),
    ])
    return pdf, "sbi_fd_receipt.pdf"


def lic_policy():
    pdf = _doc("Life Insurance Corporation of India", "Policy Schedule")
    _fields(pdf, [
        ("Policy No", "712457730"),
        ("Name of Life Assured", "RAMESH KUMAR"),
        ("Plan", "Endowment Plan (Table 914)"),
        ("Date of Commencement", "28-03-2012"),
        ("Basic Sum Assured", "Rs. 10,00,000"),
        ("Premium Mode", "Yearly - Rs. 4,850"),
        ("Nominee Name", "Sunita Kumar"),
        ("Relationship", "Wife"),
    ])
    return pdf, "lic_policy_bond.pdf"


def epf_passbook():
    pdf = _doc("Employees' Provident Fund Organisation", "Member Passbook - Financial Year 2026-27")
    _fields(pdf, [
        ("UAN", "100987654321"),
        ("Member ID", "KNBNG00123450000056789"),
        ("Member Name", "RAMESH KUMAR"),
        ("Establishment", "Sample Engineering Pvt Ltd"),
        ("Nominee", "Sunita Kumar"),
    ])
    _table(pdf, ["Particulars", "Employee Share", "Employer Share", "Pension"], [
        ["Opening Balance", "1,72,000", "1,28,000", "0"],
        ["Contributions", "11,000", "9,000", "0"],
    ], [60, 40, 40, 40])
    _fields(pdf, [("Total Balance", "Rs. 3,20,000")])
    return pdf, "epf_passbook.pdf"


def hdfc_mf():
    pdf = _doc("HDFC Mutual Fund", "Consolidated Account Statement")
    _fields(pdf, [
        ("Investor Name", "Ramesh Kumar"),
        ("Folio No", "45879012/34"),
        ("PAN", "XXXXX1234X"),
        ("Nominee", "Rahul Kumar (Son)"),
    ])
    _table(pdf, ["Scheme", "Units", "NAV (Rs.)", "Value (Rs.)"], [
        ["HDFC Flexi Cap Fund - Growth", "95.238", "1,890.00", "1,80,000.00"],
    ], [80, 30, 35, 35])
    _fields(pdf, [("Current Value", "Rs. 1,80,000.00")])
    return pdf, "hdfc_mf_statement.pdf"


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for make in (sbi_savings, sbi_fd, lic_policy, epf_passbook, hdfc_mf):
        pdf, name = make()
        pdf.output(str(OUT / name))
        print("wrote", OUT / name)
