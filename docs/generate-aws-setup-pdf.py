from fpdf import FPDF
from pathlib import Path

root = Path(__file__).resolve().parent
text = (root / "AWS-SETUP-STEPS.txt").read_text(encoding="utf-8")

pdf = FPDF()
pdf.set_auto_page_break(auto=True, margin=15)
pdf.set_margins(15, 15, 15)
pdf.add_page()
pdf.set_text_color(0, 0, 0)
pdf.set_font("Courier", size=9)

width = pdf.w - pdf.l_margin - pdf.r_margin

for line in text.splitlines():
    safe = line.encode("latin-1", "replace").decode("latin-1")
    if not safe.strip():
        pdf.ln(4)
        continue
    pdf.multi_cell(width, 4.5, safe)

out = root / "AWS-SETUP-STEPS.pdf"
pdf.output(str(out))
print(out)
