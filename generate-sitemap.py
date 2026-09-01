#!/usr/bin/env python3
"""
generate-sitemap.py — Автоматическая генерация sitemap.xml
Запуск: python generate-sitemap.py
Добавьте в GitHub Actions перед деплоем.
"""

import os
import subprocess
from datetime import datetime
from xml.etree.ElementTree import Element, SubElement, tostring
from xml.dom.minidom import parseString

BASE_URL = "https://серко.рф"
OUTPUT_FILE = "sitemap.xml"

# Список файлов и их приоритеты
PAGES = {
    "index.html":       {"priority": "1.0", "changefreq": "weekly",  "images": ["my-photo.jpg"]},
    "alimenty.html":    {"priority": "0.9", "changefreq": "weekly",  "images": ["my-photo.jpg"]},
    "razvod.html":      {"priority": "0.9", "changefreq": "weekly",  "images": ["my-photo.jpg"]},
    "about.html":       {"priority": "0.8", "changefreq": "monthly", "images": ["my-photo.jpg"]},
    "faq.html":         {"priority": "0.8", "changefreq": "weekly",  "images": []},
    "privacy.html":     {"priority": "0.3", "changefreq": "yearly",  "images": [], "noindex": True},
    "offer.html":       {"priority": "0.3", "changefreq": "yearly",  "images": [], "noindex": True},
}

IMAGE_TITLES = {
    "my-photo.jpg": {
        "title": "Серко Иван Иванович — юрист по алиментам",
        "caption": "Семейный юрист онлайн, 127+ решённых дел"
    }
}

def get_git_lastmod(filepath):
    """Получает реальную дату последнего изменения из git."""
    try:
        result = subprocess.run(
            ["git", "log", "-1", "--format=%cI", filepath],
            capture_output=True, text=True, check=True
        )
        dt = datetime.fromisoformat(result.stdout.strip().replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return datetime.now().strftime("%Y-%m-%d")

def generate():
    urlset = Element("urlset", {
        "xmlns": "http://www.sitemaps.org/schemas/sitemap/0.9",
        "xmlns:image": "http://www.google.com/schemas/sitemap-image/1.1",
        "xmlns:video": "http://www.google.com/schemas/sitemap-video/1.1"
    })

    for filename, meta in PAGES.items():
        if meta.get("noindex"):
            continue  # Не добавляем noindex-страницы в sitemap

        url = SubElement(urlset, "url")
        SubElement(url, "loc").text = f"{BASE_URL}/{filename}"
        SubElement(url, "lastmod").text = get_git_lastmod(filename)
        SubElement(url, "changefreq").text = meta["changefreq"]
        SubElement(url, "priority").text = meta["priority"]

        for img_name in meta.get("images", []):
            img_info = IMAGE_TITLES.get(img_name, {})
            img = SubElement(url, "image:image")
            SubElement(img, "image:loc").text = f"{BASE_URL}/{img_name}"
            if img_info.get("title"):
                SubElement(img, "image:title").text = img_info["title"]
            if img_info.get("caption"):
                SubElement(img, "image:caption").text = img_info["caption"]

    # Добавляем sitemap блога
    url = SubElement(urlset, "url")
    SubElement(url, "loc").text = f"{BASE_URL}/legal-blog/"
    SubElement(url, "lastmod").text = datetime.now().strftime("%Y-%m-%d")
    SubElement(url, "changefreq").text = "daily"
    SubElement(url, "priority").text = "0.9"

    xml_str = parseString(tostring(urlset, encoding="unicode")).toprettyxml(indent="  ")
    # Убираем лишние пустые строки от minidom
    lines = [line for line in xml_str.split("\n") if line.strip()]
    xml_str = "\n".join(lines)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(xml_str)

    print(f"✅ Sitemap сгенерирован: {OUTPUT_FILE}")
    print(f"   URL-ов: {len([c for c in urlset if c.tag == 'url'])}")

if __name__ == "__main__":
    generate()
