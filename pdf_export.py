"""Génération de la grille d'accords (+ plan du morceau) en PDF."""

import io
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

from chord_detector import chords_to_bar_tokens

CHORDS_PER_ROW = 4


def _chord_grid_table(tokens: list[str]) -> Table:
    """Grille d'accords façon partition : CHORDS_PER_ROW cases par ligne."""
    rows = [
        tokens[i:i + CHORDS_PER_ROW]
        for i in range(0, len(tokens), CHORDS_PER_ROW)
    ]
    # complète la dernière ligne pour que toutes les cases fassent la même largeur
    if rows and len(rows[-1]) < CHORDS_PER_ROW:
        rows[-1] += [''] * (CHORDS_PER_ROW - len(rows[-1]))

    cell_size = 3.8 * cm
    table = Table(rows, colWidths=[cell_size] * CHORDS_PER_ROW, rowHeights=1.4 * cm)
    table.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.75, colors.grey),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('FONTSIZE', (0, 0), (-1, -1), 14),
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
    ]))
    return table


def build_chord_chart_pdf(
    title: str,
    key_fr: str,
    tempo: int,
    chords: list[dict],
    structure: list[dict],
    duration: float,
) -> bytes:
    """Construit le PDF (grille d'accords, groupée par section si une
    structure a été détectée) et retourne les octets du fichier."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=1.5 * cm, bottomMargin=1.5 * cm,
        leftMargin=1.5 * cm, rightMargin=1.5 * cm,
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('ChordTitle', parent=styles['Title'], fontSize=20)
    info_style = ParagraphStyle('ChordInfo', parent=styles['Normal'], fontSize=12,
                                 textColor=colors.HexColor('#444444'))
    section_style = ParagraphStyle('SectionLabel', parent=styles['Heading2'],
                                    fontSize=13, spaceBefore=14, spaceAfter=6)

    story = [
        Paragraph(escape(title) or "Grille d'accords", title_style),
        Paragraph(escape(f'Tonalité : {key_fr}  •  Tempo : {tempo} BPM'), info_style),
        Spacer(1, 0.6 * cm),
    ]

    tokens = chords_to_bar_tokens(chords, tempo, duration)
    bar_dur = 4 * 60.0 / tempo if tempo else 0

    sections = structure or [{'label': None, 'start': 0.0, 'end': duration}]
    for sec in sections:
        b0 = int(round(sec['start'] / bar_dur)) if bar_dur else 0
        b1 = int(round(sec['end'] / bar_dur)) if bar_dur else len(tokens)
        sec_tokens = tokens[b0:b1]
        if not sec_tokens:
            continue
        if sec.get('label'):
            story.append(Paragraph(sec['label'], section_style))
        story.append(_chord_grid_table(sec_tokens))

    doc.build(story)
    return buf.getvalue()
