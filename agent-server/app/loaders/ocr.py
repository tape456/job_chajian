"""
扫描件 OCR：优先 PaddleOCR（中文效果好），其次 Tesseract。
依赖均为可选（requirements-ocr.txt），未安装时给出明确错误。
"""
from __future__ import annotations

import io

from .document import Block


def ocr_pdf(file_bytes: bytes, dpi: int = 200) -> list[Block]:
    try:
        return _ocr_paddle(file_bytes, dpi)
    except ImportError:
        return _ocr_tesseract(file_bytes, dpi)


def _render_pages(file_bytes: bytes, dpi: int):
    import fitz  # PyMuPDF（pdfplumber 已携带）
    from PIL import Image

    doc = fitz.open(stream=file_bytes, filetype="pdf")
    for page in doc:
        pix = page.get_pixmap(dpi=dpi)
        yield page.number, Image.open(io.BytesIO(pix.tobytes("png")))


def _ocr_paddle(file_bytes: bytes, dpi: int) -> list[Block]:
    import numpy as np
    from paddleocr import PaddleOCR

    ocr = PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)
    blocks: list[Block] = []
    for page_no, img in _render_pages(file_bytes, dpi):
        result = ocr.ocr(np.array(img), cls=True)
        for page_result in result or []:
            for line in page_result:
                text = line[1][0]
                bbox = (
                    line[0][0][0], line[0][0][1],
                    line[0][2][0], line[0][2][1],
                )
                blocks.append(Block(kind="paragraph", text=text, page=page_no, bbox=bbox))
    return blocks


def _ocr_tesseract(file_bytes: bytes, dpi: int) -> list[Block]:
    import pytesseract

    blocks: list[Block] = []
    for page_no, img in _render_pages(file_bytes, dpi):
        data = pytesseract.image_to_data(img, lang="chi_sim+eng", output_type=pytesseract.Output.DICT)
        for i, text in enumerate(data["text"]):
            text = (text or "").strip()
            if not text:
                continue
            x, y, w, h = data["left"][i], data["top"][i], data["width"][i], data["height"][i]
            blocks.append(
                Block(kind="paragraph", text=text, page=page_no, bbox=(x, y, x + w, y + h))
            )
    return blocks
