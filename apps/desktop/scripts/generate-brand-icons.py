#!/usr/bin/env python3
"""Generate every Masterino application icon from one source image.

The source artwork is cropped once, then placed on transparent square canvases
with purpose-specific safe padding. This keeps the icon visually consistent
without letting Windows, macOS, browsers, or maskable PWA crops clip the subject.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont


REPO_ROOT = Path(__file__).resolve().parents[3]

APP_PNG_TARGETS = (
    "apps/desktop/build/icon.png",
    "apps/desktop/build/icon-dev.png",
    "apps/desktop/build/icon-beta.png",
    "apps/desktop/build/icon-nightly.png",
)
APP_ICO_TARGETS = (
    "apps/desktop/build/icon.ico",
    "apps/desktop/build/icon-dev.ico",
    "apps/desktop/build/icon-beta.ico",
    "apps/desktop/build/icon-nightly.ico",
)
APP_ICNS_TARGETS = (
    "apps/desktop/build/Icon.icns",
    "apps/desktop/build/Icon-beta.icns",
    "apps/desktop/build/Icon-nightly.icns",
)
FAVICON_48_TARGETS = (
    "public/favicon.ico",
    "public/favicon-dev.ico",
    "public/favicon-done.ico",
    "public/favicon-done-dev.ico",
    "public/favicon-error.ico",
    "public/favicon-error-dev.ico",
    "public/favicon-progress.ico",
    "public/favicon-progress-dev.ico",
)
FAVICON_32_TARGETS = (
    "public/favicon-32x32.ico",
    "public/favicon-32x32-dev.ico",
    "public/favicon-32x32-done.ico",
    "public/favicon-32x32-done-dev.ico",
    "public/favicon-32x32-error.ico",
    "public/favicon-32x32-error-dev.ico",
    "public/favicon-32x32-progress.ico",
    "public/favicon-32x32-progress-dev.ico",
)


def pixels(image: Image.Image):
    """Return a flat pixel iterator across supported Pillow versions."""

    if hasattr(image, "get_flattened_data"):
        return image.get_flattened_data()
    return image.getdata()


def parse_crop(value: str | None) -> tuple[int, int, int, int] | None:
    if not value:
        return None
    parts = [int(part.strip()) for part in value.split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("crop must be x,y,width,height")
    x, y, width, height = parts
    if min(x, y) < 0 or min(width, height) <= 0:
        raise argparse.ArgumentTypeError("crop coordinates must be non-negative and sized")
    return x, y, x + width, y + height


def corner_background(image: Image.Image) -> tuple[int, int, int]:
    width, height = image.size
    sample_size = max(1, round(min(width, height) * 0.04))
    samples: list[tuple[int, int, int]] = []
    for left, top in (
        (0, 0),
        (width - sample_size, 0),
        (0, height - sample_size),
        (width - sample_size, height - sample_size),
    ):
        samples.extend(
            pixels(
                image.crop((left, top, left + sample_size, top + sample_size)).convert(
                    "RGB"
                )
            )
        )
    return tuple(round(statistics.median(channel)) for channel in zip(*samples))


def corner_uniformity(image: Image.Image, background: tuple[int, int, int]) -> int:
    width, height = image.size
    sample_size = max(1, round(min(width, height) * 0.04))
    maximum = 0
    for left, top in (
        (0, 0),
        (width - sample_size, 0),
        (0, height - sample_size),
        (width - sample_size, height - sample_size),
    ):
        for pixel in pixels(
            image.crop((left, top, left + sample_size, top + sample_size)).convert("RGB")
        ):
            maximum = max(maximum, *(abs(pixel[index] - background[index]) for index in range(3)))
    return maximum


def remove_flat_corner_background(
    image: Image.Image,
    *,
    threshold: int,
) -> Image.Image:
    """Turn a flat corner-matched background into a soft alpha matte."""

    rgba = image.convert("RGBA")
    background = corner_background(rgba)
    rgb = rgba.convert("RGB")
    background_image = Image.new("RGB", rgba.size, background)
    difference = ImageChops.difference(rgb, background_image)
    channels = difference.split()
    distance = Image.new("L", rgba.size)
    distance.putdata(
        [
            max(red, green, blue)
            for red, green, blue in zip(
                pixels(channels[0]),
                pixels(channels[1]),
                pixels(channels[2]),
            )
        ]
    )
    soft_range = max(8, threshold * 2)
    matte = distance.point(
        lambda value: max(0, min(255, round((value - threshold) * 255 / soft_range)))
    )
    original_alpha = rgba.getchannel("A")
    rgba.putalpha(ImageChops.multiply(original_alpha, matte))
    return rgba


def alpha_bbox(image: Image.Image, threshold: int) -> tuple[int, int, int, int] | None:
    alpha = image.getchannel("A")
    return alpha.point(lambda value: 255 if value > threshold else 0).getbbox()


def prepare_source(
    source: Path,
    *,
    crop: tuple[int, int, int, int] | None,
    trim_mode: str,
    threshold: int,
) -> tuple[Image.Image, dict[str, object]]:
    with Image.open(source) as opened:
        image = opened.convert("RGBA")

    original_size = image.size
    if crop:
        if crop[2] > image.width or crop[3] > image.height:
            raise ValueError(f"crop {crop} exceeds source size {image.size}")
        image = image.crop(crop)

    applied_mode = trim_mode
    alpha_extrema = image.getchannel("A").getextrema()
    if trim_mode == "auto":
        if alpha_extrema[0] < 250:
            applied_mode = "alpha"
        else:
            background = corner_background(image)
            applied_mode = (
                "corner" if corner_uniformity(image, background) <= max(10, threshold) else "none"
            )

    if applied_mode == "corner":
        keyed = remove_flat_corner_background(image, threshold=threshold)
        keyed_bbox = alpha_bbox(keyed, threshold=4)
        # Avoid turning an intended full-canvas illustration into an empty or
        # accidental tiny cutout when the corners are not really a background.
        if keyed_bbox:
            bbox_area = (keyed_bbox[2] - keyed_bbox[0]) * (keyed_bbox[3] - keyed_bbox[1])
            coverage = bbox_area / (image.width * image.height)
            if 0.01 <= coverage <= 0.985:
                image = keyed
            else:
                applied_mode = "none"
        else:
            applied_mode = "none"

    bbox = alpha_bbox(image, threshold=4) if applied_mode in {"alpha", "corner"} else None
    if bbox:
        image = image.crop(bbox)
    else:
        bbox = (0, 0, image.width, image.height)

    if image.width <= 0 or image.height <= 0:
        raise ValueError("source image has no visible content after cropping")

    return image, {
        "source": str(source),
        "originalSize": list(original_size),
        "manualCrop": list(crop) if crop else None,
        "trimModeRequested": trim_mode,
        "trimModeApplied": applied_mode,
        "contentBounds": list(bbox),
        "croppedSize": list(image.size),
    }


def canvas_for(
    content: Image.Image,
    size: int,
    *,
    content_scale: float,
    background: tuple[int, int, int, int] = (0, 0, 0, 0),
) -> Image.Image:
    maximum = max(1, round(size * content_scale))
    ratio = min(maximum / content.width, maximum / content.height)
    resized_size = (
        max(1, round(content.width * ratio)),
        max(1, round(content.height * ratio)),
    )
    resized = content.resize(resized_size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), background)
    offset = ((size - resized.width) // 2, (size - resized.height) // 2)
    canvas.alpha_composite(resized, offset)
    return canvas


def template_canvas(content: Image.Image, size: int, *, content_scale: float) -> Image.Image:
    canvas = canvas_for(content, size, content_scale=content_scale)
    alpha = canvas.getchannel("A")
    visible = alpha.point(lambda value: 255 if value > 12 else 0)
    visible_bbox = visible.getbbox()

    # A source with a mostly opaque rectangular/rounded background would become
    # an unreadable solid block if its alpha channel were used directly as a
    # macOS template. In that case derive template opacity from luminance so the
    # artwork's internal features remain visible in both light and dark menus.
    if visible_bbox:
        cropped_alpha = alpha.crop(visible_bbox)
        opaque_pixels = sum(1 for value in pixels(cropped_alpha) if value >= 245)
        opaque_ratio = opaque_pixels / (cropped_alpha.width * cropped_alpha.height)
    else:
        opaque_ratio = 0

    luminance = canvas.convert("L")
    opaque_luminance = [
        value
        for value, alpha_value in zip(pixels(luminance), pixels(alpha))
        if alpha_value >= 245
    ]
    median_luminance = statistics.median(opaque_luminance) if opaque_luminance else 255

    if opaque_ratio >= 0.95 or median_luminance >= 220:
        detail = (
            luminance.point(lambda value: 255 - value)
            if median_luminance >= 128
            else luminance
        )
        detail = detail.point(
            lambda value: (
                0
                if value <= 10
                else 255
                if value >= 48
                else round((value - 10) * 255 / 38)
            )
        )
        alpha = ImageChops.multiply(alpha, detail)

    template = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    template.putalpha(alpha)
    return template


def save_png(image: Image.Image, targets: Iterable[str], output_root: Path) -> None:
    for relative in targets:
        target = output_root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        image.save(target, "PNG", optimize=True)


def save_ico(
    image: Image.Image,
    targets: Iterable[str],
    output_root: Path,
    *,
    sizes: tuple[int, ...],
) -> None:
    square_sizes = [(size, size) for size in sizes]
    for relative in targets:
        target = output_root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        image.save(target, "ICO", sizes=square_sizes)


def save_app_ico(
    content: Image.Image,
    small_content: Image.Image,
    targets: Iterable[str],
    output_root: Path,
    *,
    app_scale: float,
) -> None:
    sizes = (16, 24, 32, 48, 64, 128, 256)
    frames: list[Image.Image] = []
    for size in sizes:
        if size <= 48:
            frame = canvas_for(small_content, size, content_scale=0.9)
            frame = frame.filter(ImageFilter.UnsharpMask(radius=0.6, percent=180, threshold=1))
        else:
            frame = canvas_for(content, size, content_scale=app_scale)
        frames.append(frame)

    for relative in targets:
        target = output_root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        frames[-1].save(
            target,
            "ICO",
            append_images=frames[:-1],
            sizes=[(size, size) for size in sizes],
        )


def save_icns(image: Image.Image, targets: Iterable[str], output_root: Path) -> None:
    frames = [
        image.resize((size, size), Image.Resampling.LANCZOS)
        for size in (32, 64, 128, 256, 512, 1024)
    ]
    for relative in targets:
        target = output_root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        frames[-1].save(target, "ICNS", append_images=frames[:-1])


def checkerboard(size: tuple[int, int], cell: int = 10) -> Image.Image:
    board = Image.new("RGB", size, "#f1f1f1")
    draw = ImageDraw.Draw(board)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill="#d9d9d9")
    return board


def save_preview(
    samples: list[tuple[str, Image.Image]],
    target: Path,
) -> None:
    tile_width = 190
    tile_height = 220
    columns = 4
    rows = math.ceil(len(samples) / columns)
    preview = Image.new("RGB", (tile_width * columns, tile_height * rows), "white")
    draw = ImageDraw.Draw(preview)
    font = ImageFont.load_default()
    for index, (label, sample) in enumerate(samples):
        column = index % columns
        row = index // columns
        left = column * tile_width
        top = row * tile_height
        backdrop = checkerboard((160, 160))
        display = sample.copy()
        display.thumbnail((144, 144), Image.Resampling.LANCZOS)
        backdrop.paste(
            display,
            ((160 - display.width) // 2, (160 - display.height) // 2),
            display,
        )
        preview.paste(backdrop, (left + 15, top + 12))
        draw.text((left + 15, top + 180), label, fill="#111111", font=font)
    target.parent.mkdir(parents=True, exist_ok=True)
    preview.save(target, "PNG", optimize=True)


def load_brand_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Load a bold sans font from the current build platform."""

    candidates = (
        Path("C:/Windows/Fonts/arialbd.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    )
    for candidate in candidates:
        if candidate.is_file():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def fit_brand_font(
    text: str,
    *,
    maximum_width: int,
    preferred_size: int,
    minimum_size: int,
) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for size in range(preferred_size, minimum_size - 1, -1):
        font = load_brand_font(size)
        left, _, right, _ = font.getbbox(text)
        if right - left <= maximum_width:
            return font
    return load_brand_font(minimum_size)


def save_packaging_brand_art(output_root: Path) -> None:
    """Generate installer artwork with the exact Masterino product name."""

    wordmark = "Masterino"

    header = Image.new("RGB", (150, 57), "black")
    header_draw = ImageDraw.Draw(header)
    header_font = fit_brand_font(
        wordmark,
        maximum_width=126,
        preferred_size=25,
        minimum_size=18,
    )
    header_box = header_draw.textbbox((0, 0), wordmark, font=header_font)
    header_height = header_box[3] - header_box[1]
    header_draw.text(
        (15, (57 - header_height) // 2 - header_box[1]),
        wordmark,
        fill="white",
        font=header_font,
    )
    header_target = output_root / "apps/desktop/build/nsis-header.bmp"
    header_target.parent.mkdir(parents=True, exist_ok=True)
    header.save(header_target, "BMP")

    width, height = 600, 400
    dmg = Image.new("RGB", (width, height), "white")
    gradient = Image.new("RGB", (width // 2, height))
    gradient_pixels = gradient.load()
    top_left = (255, 224, 103)
    top_right = (255, 194, 79)
    bottom_left = (255, 153, 32)
    bottom_right = (255, 102, 0)
    for y in range(height):
        vertical = y / (height - 1)
        for x in range(width // 2):
            horizontal = x / (width // 2 - 1)
            top = tuple(
                round(top_left[index] * (1 - horizontal) + top_right[index] * horizontal)
                for index in range(3)
            )
            bottom = tuple(
                round(bottom_left[index] * (1 - horizontal) + bottom_right[index] * horizontal)
                for index in range(3)
            )
            gradient_pixels[x, y] = tuple(
                round(top[index] * (1 - vertical) + bottom[index] * vertical)
                for index in range(3)
            )
    dmg.paste(gradient, (width // 2, 0))

    dmg_draw = ImageDraw.Draw(dmg)
    dmg_font = fit_brand_font(
        wordmark,
        maximum_width=225,
        preferred_size=38,
        minimum_size=28,
    )
    dmg_draw.text((26, 20), wordmark, fill="#050505", font=dmg_font)

    arrow_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    arrow_draw = ImageDraw.Draw(arrow_layer)
    arrow = (
        (282, 237),
        (309, 237),
        (309, 221),
        (345, 254),
        (309, 287),
        (309, 271),
        (282, 271),
    )
    glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.polygon(arrow, fill=(255, 239, 218, 180))
    glow = glow.filter(ImageFilter.GaussianBlur(10))
    arrow_layer.alpha_composite(glow)
    arrow_draw.polygon(
        arrow,
        fill=(255, 218, 180, 180),
        outline=(255, 239, 218, 220),
    )
    dmg = Image.alpha_composite(dmg.convert("RGBA"), arrow_layer)
    dmg_target = output_root / "apps/desktop/resources/dmg.png"
    dmg_target.parent.mkdir(parents=True, exist_ok=True)
    dmg.save(dmg_target, "PNG", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="source PNG/JPG/WebP artwork")
    parser.add_argument(
        "--small-source",
        type=Path,
        help="optional square close crop used for favicon and tray sizes",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=REPO_ROOT,
        help="repository root or a temporary preview root",
    )
    parser.add_argument(
        "--crop",
        type=parse_crop,
        help="manual source crop as x,y,width,height before automatic trim",
    )
    parser.add_argument(
        "--trim-mode",
        choices=("auto", "alpha", "corner", "none"),
        default="auto",
        help="how to isolate visible artwork",
    )
    parser.add_argument(
        "--trim-threshold",
        type=int,
        default=12,
        help="alpha/background tolerance from 0 to 255",
    )
    parser.add_argument(
        "--app-scale",
        type=float,
        default=0.84,
        help="subject coverage for application icons",
    )
    parser.add_argument(
        "--maskable-scale",
        type=float,
        default=0.66,
        help="subject coverage inside the PWA maskable safe zone",
    )
    args = parser.parse_args()

    source = args.source.resolve()
    output_root = args.output_root.resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    if not 0 < args.app_scale <= 1 or not 0 < args.maskable_scale <= 0.8:
        raise ValueError("app scale must be <= 1 and maskable scale must be <= 0.8")
    if not 0 <= args.trim_threshold <= 255:
        raise ValueError("trim threshold must be between 0 and 255")

    content, report = prepare_source(
        source,
        crop=args.crop,
        trim_mode=args.trim_mode,
        threshold=args.trim_threshold,
    )
    small_content = content
    if args.small_source:
        small_source = args.small_source.resolve()
        if not small_source.is_file():
            raise FileNotFoundError(small_source)
        small_content, small_report = prepare_source(
            small_source,
            crop=None,
            trim_mode="none",
            threshold=args.trim_threshold,
        )
        report["smallSource"] = small_report

    app_1024 = canvas_for(content, 1024, content_scale=args.app_scale)
    app_512 = canvas_for(content, 512, content_scale=args.app_scale)
    favicon_48 = canvas_for(small_content, 48, content_scale=0.9)
    favicon_32 = canvas_for(small_content, 32, content_scale=0.9)
    tray_32 = canvas_for(small_content, 32, content_scale=0.86)
    tray_template_18 = template_canvas(small_content, 18, content_scale=0.82)
    tray_template_36 = template_canvas(small_content, 36, content_scale=0.82)
    apple_180 = canvas_for(content, 180, content_scale=0.82)
    pwa_192 = canvas_for(content, 192, content_scale=args.app_scale)
    pwa_512 = canvas_for(content, 512, content_scale=args.app_scale)
    maskable_192 = canvas_for(content, 192, content_scale=args.maskable_scale)
    maskable_512 = canvas_for(content, 512, content_scale=args.maskable_scale)

    save_png(app_512, APP_PNG_TARGETS, output_root)
    save_app_ico(
        content,
        small_content,
        APP_ICO_TARGETS,
        output_root,
        app_scale=args.app_scale,
    )
    save_icns(app_1024, APP_ICNS_TARGETS, output_root)
    save_ico(favicon_48, FAVICON_48_TARGETS, output_root, sizes=(16, 24, 32, 48))
    save_ico(favicon_32, FAVICON_32_TARGETS, output_root, sizes=(16, 24, 32))
    save_png(tray_32, ("apps/desktop/resources/tray.png",), output_root)
    save_png(
        tray_template_18,
        ("apps/desktop/resources/trayTemplate.png",),
        output_root,
    )
    save_png(
        tray_template_36,
        ("apps/desktop/resources/trayTemplate@2x.png",),
        output_root,
    )
    save_png(apple_180, ("public/apple-touch-icon.png",), output_root)
    save_png(pwa_192, ("public/icons/icon-192x192.png",), output_root)
    save_png(pwa_512, ("public/icons/icon-512x512.png",), output_root)
    save_png(
        maskable_192,
        ("public/icons/icon-192x192.maskable.png",),
        output_root,
    )
    save_png(
        maskable_512,
        ("public/icons/icon-512x512.maskable.png",),
        output_root,
    )
    save_packaging_brand_art(output_root)

    preview_target = output_root / "apps/desktop/build/icon-preview.png"
    save_preview(
        [
            (f"Application · {round(args.app_scale * 100)}% safe area", app_512),
            (f"PWA maskable · {round(args.maskable_scale * 100)}% safe area", maskable_512),
            ("Favicon · 32 px", favicon_32),
            ("Windows tray · 32 px", tray_32),
            ("macOS template · 18 px", tray_template_18),
            ("Apple touch · 180 px", apple_180),
        ],
        preview_target,
    )

    report.update(
        {
            "appContentScale": args.app_scale,
            "maskableContentScale": args.maskable_scale,
            "outputRoot": str(output_root),
            "preview": str(preview_target),
        }
    )
    report_target = output_root / "apps/desktop/build/icon-generation-report.json"
    report_target.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
