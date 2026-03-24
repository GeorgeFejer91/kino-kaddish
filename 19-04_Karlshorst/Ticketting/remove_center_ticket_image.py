import argparse
from pathlib import Path
import re

import fitz


def choose_target_image(page: fitz.Page) -> tuple[int, str, fitz.Rect] | None:
    candidates: list[tuple[float, int, str, fitz.Rect]] = []
    for image in page.get_images(full=True):
        xref = image[0]
        name = image[7]
        for rect in page.get_image_rects(xref):
            area = rect.width * rect.height
            candidates.append((area, xref, name, rect))

    if not candidates:
        return None

    # In this ticket layout, the inserted poster is the largest placed image.
    _, xref, name, rect = max(candidates, key=lambda item: item[0])
    return xref, name, rect


def make_empty_template(input_pdf: Path, output_pdf: Path) -> None:
    doc = fitz.open(input_pdf)

    for page in doc:
        target = choose_target_image(page)
        if target is None:
            continue

        image_xref, image_name, _ = target

        # Remove only the selected image draw command from the page contents.
        for content_xref in page.get_contents():
            stream = doc.xref_stream(content_xref)
            updated = stream.replace(f"/{image_name} Do".encode("ascii"), b"")
            if updated != stream:
                doc.update_stream(content_xref, updated)

        # Drop the image from the page resources so garbage collection can remove it.
        page_object = doc.xref_object(page.xref, compressed=False)
        updated_page_object = re.sub(
            rf"\s*/{re.escape(image_name)}\s+{image_xref}\s+0\s+R",
            "",
            page_object,
        )
        if updated_page_object != page_object:
            doc.update_object(page.xref, updated_page_object)

    doc.save(output_pdf, garbage=4, clean=True, deflate=True)
    doc.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Remove the main embedded poster image from a ticket PDF."
    )
    parser.add_argument("input_pdf", type=Path, help="Source ticket PDF")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Output PDF path. Defaults to '<input>_empty.pdf'.",
    )
    args = parser.parse_args()

    input_pdf = args.input_pdf.resolve()
    output_pdf = args.output or input_pdf.with_name(f"{input_pdf.stem}_empty.pdf")
    output_pdf = output_pdf.resolve()

    make_empty_template(input_pdf, output_pdf)
    print(output_pdf)


if __name__ == "__main__":
    main()
