"""
PDF 加载器（pdfplumber）：文本行 + 表格配对；扫描件自动检测并走 OCR。
"""
from __future__ import annotations

import io

from .document import Block, NormalizedDocument, render_for_llm
from .table_pairing import looks_record_header, pair_cells
from ..rules.patterns import match_section_title


def _table_rows_to_blocks(rows, page_no: int) -> list[Block]:
    blocks: list[Block] = []
    record_mode = False
    for row in rows or []:
        cells = [(c or "").replace("\n", " ").strip() for c in row]
        nonempty = [c for c in cells if c]
        if not nonempty:
            continue
        if not record_mode and looks_record_header(nonempty):
            record_mode = True
            continue
        if record_mode:
            blocks.append(Block(kind="record", text=" | ".join(nonempty), page=page_no))
            continue
        pairs = pair_cells(cells)
        if pairs:
            for label, value in pairs:
                blocks.append(Block(kind="kv", label=label, value=value, page=page_no))
        else:
            blocks.extend(Block(kind="paragraph", text=c, page=page_no) for c in nonempty)
    return blocks


def load_pdf(file_bytes: bytes, file_name: str, use_ocr: bool = True) -> NormalizedDocument:
    blocks: list[Block] = []
    text_chars = 0

    with pdfplumber_open(file_bytes) as pdf:
        for page in pdf.pages:
            page_no = page.page_number
            # 表格
            for table in page.extract_tables() or []:
                blocks.extend(_table_rows_to_blocks(table, page_no))
            # 文本行（表格区域文本可能重复，合并阶段去重，无害）
            text = page.extract_text() or ""
            text_chars += len(text.strip())
            for raw in text.splitlines():
                line = raw.strip()
                if not line:
                    continue
                if match_section_title(line):
                    blocks.append(Block(kind="heading", text=line, page=page_no))
                else:
                    blocks.append(Block(kind="paragraph", text=line, page=page_no))

    needs_ocr = text_chars < 20
    if needs_ocr and use_ocr:
        from .ocr import ocr_pdf

        ocr_blocks = ocr_pdf(file_bytes)
        if ocr_blocks:
            blocks = ocr_blocks
            needs_ocr = False

    return NormalizedDocument(
        file_name=file_name,
        file_type="pdf",
        blocks=blocks,
        text=render_for_llm(blocks),
        needs_ocr=needs_ocr,
    )


def pdfplumber_open(file_bytes: bytes):
    import pdfplumber

    return pdfplumber.open(io.BytesIO(file_bytes))
