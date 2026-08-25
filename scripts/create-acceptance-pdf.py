from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


OUTPUT = Path("output/pdf/agent-squad-real-input-acceptance.pdf")


def footer(canvas, document):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#53616F"))
    canvas.drawString(18 * mm, 12 * mm, "Agent/Squad production acceptance fixture")
    canvas.drawRightString(192 * mm, 12 * mm, f"Page {document.page}")
    canvas.restoreState()


def build_pdf():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    styles = getSampleStyleSheet()
    title = ParagraphStyle("Title", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=22, leading=27, textColor=colors.HexColor("#18324A"), spaceAfter=14)
    heading = ParagraphStyle("Heading", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=14, leading=18, textColor=colors.HexColor("#156B73"), spaceBefore=8, spaceAfter=8)
    body = ParagraphStyle("Body", parent=styles["BodyText"], fontName="Helvetica", fontSize=10.5, leading=15, textColor=colors.HexColor("#263746"), spaceAfter=7)
    note = ParagraphStyle("Note", parent=body, backColor=colors.HexColor("#E9F3F2"), borderColor=colors.HexColor("#8AB7B2"), borderWidth=0.6, borderPadding=8, spaceBefore=8, spaceAfter=10)
    center = ParagraphStyle("Center", parent=body, alignment=TA_CENTER, fontName="Helvetica-Bold", fontSize=9, leading=12)
    table_text = ParagraphStyle("TableText", parent=body, fontSize=8, leading=10, spaceAfter=0)
    table_header = ParagraphStyle("TableHeader", parent=table_text, fontName="Helvetica-Bold", textColor=colors.white)

    doc = SimpleDocTemplate(str(OUTPUT), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=18 * mm, bottomMargin=20 * mm, title="Agent/Squad Real Input Acceptance")
    story = [
        Paragraph("Agent/Squad Delivery Acceptance", title),
        Paragraph("Real PDF input fixture - revision 1", heading),
        Paragraph("This document defines a bounded production-readiness exercise for a Leader coordinating three delegated child Issues. The source of truth is the parent Issue assignment revision and its Leader coordination TaskRun.", body),
        Paragraph("Business rules", heading),
        Table([
            [Paragraph("ID", table_header), Paragraph("Rule", table_header), Paragraph("Required evidence", table_header)],
            [Paragraph("R-01", table_text), Paragraph("A Leader may dispatch up to three child Delegations in one coordination epoch.", table_text), Paragraph("Three distinct child TaskRuns", table_text)],
            [Paragraph("R-02", table_text), Paragraph("The fourth active Delegation must be rejected with a capacity conflict.", table_text), Paragraph("Rejected command record", table_text)],
            [Paragraph("R-03", table_text), Paragraph("Child Reviews may arrive out of order and one child may fail then retry.", table_text), Paragraph("All Review and retry evidence", table_text)],
            [Paragraph("R-04", table_text), Paragraph("The Leader wakes once only after every child reaches a reviewed terminal state.", table_text), Paragraph("Exactly one continuation TaskRun", table_text)],
        ], colWidths=[18 * mm, 103 * mm, 49 * mm], repeatRows=1, style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#18324A")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTNAME", (0, 1), (0, -1), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
            ("LEADING", (0, 0), (-1, -1), 11),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#A8B5BF")),
            ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#F7F9FA")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ])),
        Spacer(1, 10),
        Paragraph("Initial dependency timeout: 30 seconds. A timeout is a dependency failure and must not be returned as business success.", note),
        PageBreak(),
        Paragraph("Controlled Revision", title),
        Paragraph("Revision 2 - supersedes the timeout in revision 1", heading),
        Paragraph("Decision D-01 is approved by the delivery owner: increase the dependency timeout from 30 seconds to 45 seconds. All other requirements remain unchanged. The planning result must identify this conflict and use the approved value of 45 seconds.", note),
        Paragraph("Failure and recovery semantics", heading),
        Table([
            [Paragraph("Condition", table_header), Paragraph("State owner", table_header), Paragraph("Expected behavior", table_header)],
            [Paragraph("One child Review fails", table_text), Paragraph("Delegation", table_text), Paragraph("Acceptance becomes failed; retain failure evidence.", table_text)],
            [Paragraph("Failed child retries", table_text), Paragraph("Child Issue / TaskRun", table_text), Paragraph("Acceptance returns to open; preserve the previous attempt.", table_text)],
            [Paragraph("Host restarts before Leader wake", table_text), Paragraph("Coordination TaskRun", table_text), Paragraph("Recover one idempotent Leader continuation.", table_text)],
            [Paragraph("Late callback after parent reassignment", table_text), Paragraph("Parent Issue revision", table_text), Paragraph("Reject as stale; publish no evidence.", table_text)],
        ], colWidths=[45 * mm, 43 * mm, 82 * mm], repeatRows=1, style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#156B73")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
            ("LEADING", (0, 0), (-1, -1), 11),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#A8B5BF")),
            ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#F7F9FA")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ])),
        Spacer(1, 12),
        Paragraph("Acceptance signal: all four Review events (including the failed attempt) remain traceable, final acceptance is verified, and there is one Leader wake activity.", body),
        PageBreak(),
        Paragraph("Coordination Flow", title),
        Paragraph("Visual page used to verify ordered page rendering and image input", heading),
        Spacer(1, 12),
        Table([
            [Paragraph("PARENT ISSUE<br/>assignment revision", center)],
            [Paragraph("LEADER COORDINATION TASKRUN", center)],
            [Table([[Paragraph("CHILD A<br/>fail -> retry", center), Paragraph("CHILD B<br/>last callback", center), Paragraph("CHILD C<br/>first callback", center)]], colWidths=[52 * mm] * 3, style=TableStyle([
                ("BOX", (0, 0), (-1, -1), 1.2, colors.HexColor("#156B73")),
                ("INNERGRID", (0, 0), (-1, -1), 0.8, colors.HexColor("#8AB7B2")),
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#E9F3F2")),
                ("TOPPADDING", (0, 0), (-1, -1), 14),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
            ]))],
            [Paragraph("OUT-OF-ORDER REVIEWS + EVIDENCE", center)],
            [Paragraph("ONE IDEMPOTENT LEADER CONTINUATION", center)],
        ], colWidths=[164 * mm], style=TableStyle([
            ("BOX", (0, 0), (-1, 0), 1.2, colors.HexColor("#18324A")),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#DCE7EF")),
            ("BOX", (0, 1), (-1, 1), 1.2, colors.HexColor("#18324A")),
            ("BACKGROUND", (0, 1), (-1, 1), colors.HexColor("#EEF2F5")),
            ("BOX", (0, 3), (-1, 3), 1.2, colors.HexColor("#B06A24")),
            ("BACKGROUND", (0, 3), (-1, 3), colors.HexColor("#FFF1DF")),
            ("BOX", (0, 4), (-1, 4), 1.5, colors.HexColor("#2D7048")),
            ("BACKGROUND", (0, 4), (-1, 4), colors.HexColor("#E4F3E9")),
            ("TOPPADDING", (0, 0), (-1, -1), 12),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ])),
        Spacer(1, 18),
        Paragraph("Arrows are represented by vertical reading order so the page remains legible in both PDF rendering and extracted text. The actual acceptance runner must submit page images in page-number order: 1, 2, 3.", note),
    ]
    doc.build(story, onFirstPage=footer, onLaterPages=footer)


if __name__ == "__main__":
    build_pdf()
    print(OUTPUT.resolve())
