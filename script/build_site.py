#!/usr/bin/env python3
"""Build the project website and copy the unmodified browser app for Pages."""

import html
import json
from pathlib import Path
import shutil
from string import Template

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "work" / "site"
BASE = "https://fedyalight.github.io/efir"
REPO = "https://github.com/FedyaLight/efir"
LOCALES = {"en": "en", "ru": "ru", "es": "es", "zh": "zh-Hans", "hi": "hi", "ar": "ar"}
PACKAGES = {
    "macos": ("macOS", "Efir-macOS.zip"),
    "windows": ("Windows x64", "Efir-Windows-x64.zip"),
    "linux-x64": ("Linux x64", "Efir-Linux-x64.deb"),
    "linux-arm64": ("Linux ARM64", "Efir-Linux-arm64.deb"),
    "android": ("Android", "Efir-Android.apk"),
}


def page_path(language):
    return "" if language == "en" else f"{language}/"


def build():
    messages = json.loads((ROOT / "site/messages.json").read_text())
    template = Template((ROOT / "site/template.html").read_text())
    # Only the fixed, ignored output directory is replaced.
    if OUT.exists():
        shutil.rmtree(OUT)
    assets = OUT / "assets"
    assets.mkdir(parents=True)
    shutil.copy(ROOT / "site/style.css", assets / "style.css")
    shutil.copy(ROOT / "site/social.png", assets / "social.png")
    shutil.copy(ROOT / "web/icon.svg", assets / "icon.svg")
    for name in PACKAGES:
        shutil.copy(ROOT / f"docs/assets/download-{name}.svg", assets)
    # Keep modules, relative paths and hosted WebRTC behavior identical to web/.
    shutil.copytree(ROOT / "web", OUT / "app", ignore=shutil.ignore_patterns(".*", "README.md", "netlify.toml"))
    (OUT / ".nojekyll").touch()

    for language, locale in LOCALES.items():
        text = messages[language]
        prefix = "." if language == "en" else ".."
        canonical = f"{BASE}/{page_path(language)}"
        data = {key: html.escape(value, quote=True) for key, value in text.items() if isinstance(value, str)}
        data.update(lang=locale, direction="rtl" if language == "ar" else "ltr", prefix=prefix,
                    canonical=canonical, base=BASE, repo=REPO)
        data["alternates"] = "\n  ".join(
            f'<link rel="alternate" hreflang="{tag}" href="{BASE}/{page_path(code)}">'
            for code, tag in LOCALES.items()
        ) + f'\n  <link rel="alternate" hreflang="x-default" href="{BASE}/">'
        data["language_links"] = " ".join(
            f'<a href="{prefix}/{page_path(code)}" lang="{tag}" hreflang="{tag}"'
            + (' aria-current="page"' if code == language else "")
            + f'>{html.escape(messages[code]["name"])}</a>'
            for code, tag in LOCALES.items()
        )
        data["features"] = "".join(
            f"<article><h3>{html.escape(title)}</h3><p>{html.escape(body)}</p></article>"
            for title, body in text["features"]
        )
        data["steps"] = "".join(f"<li>{html.escape(step)}</li>" for step in text["steps"])
        data["faq"] = "".join(
            f"<dt>{html.escape(question)}</dt><dd>{html.escape(answer)}</dd>"
            for question, answer in text["faq"]
        )
        data["downloads"] = "".join(
            f'<a href="{REPO}/releases/latest/download/{filename}" aria-label="{html.escape(text["download"])}: {label}">'
            f'<img src="{prefix}/assets/download-{name}.svg" width="200" height="48" alt="{label}"></a>'
            for name, (label, filename) in PACKAGES.items()
        )
        data["schema"] = json.dumps({
            "@context": "https://schema.org", "@type": "SoftwareApplication", "name": "Efir",
            "alternateName": "Эфир", "url": canonical, "description": text["description"],
            "applicationCategory": "MultimediaApplication", "operatingSystem": "macOS, Windows, Linux, Android, Web",
            "softwareVersion": "1.3.2", "inLanguage": list(LOCALES.values()),
            "license": f"{REPO}/blob/main/LICENSE", "sameAs": REPO,
            "downloadUrl": f"{REPO}/releases/latest", "image": f"{BASE}/assets/social.png",
            "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
            "author": {"@type": "Person", "name": "FedyaLight", "url": "https://github.com/FedyaLight"},
        }, ensure_ascii=False).replace("<", "\\u003c")
        directory = OUT / page_path(language)
        directory.mkdir(exist_ok=True)
        (directory / "index.html").write_text(template.substitute(data))

    (OUT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(f"  <url><loc>{BASE}/{page_path(code)}</loc></url>\n" for code in LOCALES)
        + "</urlset>\n"
    )
    shutil.copy(ROOT / "site/robots.txt", OUT / "robots.txt")
    shutil.copy(ROOT / "site/llms.txt", OUT / "llms.txt")
    print(f"Built {len(LOCALES)} static pages and the browser app in {OUT}")


if __name__ == "__main__":
    build()
