#!/usr/bin/env python3
"""Render-check helper for tools/rubric.mjs. Usage: python3 tools/render_check.py <file-url>
Prints JSON: {"rows": <tbody tr count>, "errors": [...]}.
"""
import json
import sys

from playwright.sync_api import sync_playwright

url = sys.argv[1]
errors = []
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    page.goto(url)
    page.wait_for_timeout(1200)
    rows = page.evaluate("document.querySelectorAll('tbody tr').length")
    browser.close()
print(json.dumps({"rows": rows, "errors": errors[:5]}))
