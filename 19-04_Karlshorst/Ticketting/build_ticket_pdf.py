import argparse
from io import BytesIO
from pathlib import Path

import fitz
from PIL import Image

Image.MAX_IMAGE_PIXELS = None


FRAME_BOTTOM_Y = 297.3
SIDE_MARGIN = 42.52
SAFE_PADDING = 8.0
DEFAULT_FOOTER_TOP_Y = 763.89
MAX_POSTER_SIZE = (1800, 2400)


def detect_footer_top(page: fitz.Page) -> float:
    footer_tops: list[float] = []
    for image in page.get_images(full=True):
        xref = image[0]
        for rect in page.get_image_rects(xref):
            if rect.y0 > page.rect.height / 2 and rect.width > 100:
                footer_tops.append(rect.y0)

    if footer_tops:
        return min(footer_tops)
    return DEFAULT_FOOTER_TOP_Y


def fit_centered(container: fitz.Rect, width: int, height: int) -> fitz.Rect:
    scale = min(container.width / width, container.height / height)
    fitted_width = width * scale
    fitted_height = height * scale
    x0 = container.x0 + (container.width - fitted_width) / 2
    y0 = container.y0 + (container.height - fitted_height) / 2
    return fitz.Rect(x0, y0, x0 + fitted_width, y0 + fitted_height)


def load_poster_stream(poster_image: Path) -> tuple[bytes, int, int]:
    with Image.open(poster_image) as image:
        image = image.convert("RGB")
        image.thumbnail(MAX_POSTER_SIZE, Image.Resampling.LANCZOS)
        width, height = image.size
        buffer = BytesIO()
        image.save(buffer, format="PNG", optimize=True)
        return buffer.getvalue(), width, height


def build_ticket(template_pdf: Path, poster_image: Path, output_pdf: Path) -> None:
    doc = fitz.open(template_pdf)
    page = doc[0]

    footer_top = detect_footer_top(page)
    usable_area = fitz.Rect(
        SIDE_MARGIN + SAFE_PADDING,
        FRAME_BOTTOM_Y + SAFE_PADDING,
        page.rect.width - SIDE_MARGIN - SAFE_PADDING,
        footer_top - SAFE_PADDING,
    )

    poster_stream, poster_width, poster_height = load_poster_stream(poster_image)
    target_rect = fit_centered(usable_area, poster_width, poster_height)

    page.insert_image(target_rect, stream=poster_stream, keep_proportion=True, overlay=True)
    temp_output = output_pdf.with_name(f"{output_pdf.stem}.tmp.pdf")
    doc.save(temp_output, garbage=4, clean=True, deflate=True)
    doc.close()
    if output_pdf.exists():
        output_pdf.unlink()
    temp_output.replace(output_pdf)


def main() -> None:
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(
        description="Build a ticket PDF by placing a centered poster on the central ticket template."
    )
    parser.add_argument("poster_image", type=Path, help="Poster image to place on the ticket")
    parser.add_argument(
        "-t",
        "--template",
        type=Path,
        default=here / "ticket_central_template.pdf",
        help="Base ticket template PDF",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Output PDF path. Defaults to 'ticket_<poster-stem>.pdf' in the template folder.",
    )
    args = parser.parse_args()

    template_pdf = args.template.resolve()
    poster_image = args.poster_image.resolve()
    output_pdf = args.output or template_pdf.with_name(f"ticket_{poster_image.stem}.pdf")
    output_pdf = output_pdf.resolve()

    build_ticket(template_pdf, poster_image, output_pdf)
    print(output_pdf)


if __name__ == "__main__":
    main()
