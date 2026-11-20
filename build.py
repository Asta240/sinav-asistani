#!/usr/bin/env python3
"""src/sinav-asistani.html → index.html (Vercel'deki asıl site).
Kaynak dosya iki yerde çalışır:
  - claude.ai artifact sürümü (STANDALONE=false): src dosyası olduğu gibi yayınlanır
  - Vercel sürümü (STANDALONE=true): bu script başına küçük bir ayar satırı ekler
Kullanım:  python3 build.py
"""
from pathlib import Path
AYIRICI_URL = "https://claude.ai/artifact/Ds98xGWsqprjqbzfDFFvtT"
src = Path(__file__).with_name("src") / "sinav-asistani.html"
s = src.read_text(encoding="utf-8")
marker = "<script>\n// STANDALONE"
assert s.count(marker) == 1, "STANDALONE işaretçisi bulunamadı"
s = s.replace(marker, f'<script>window.STANDALONE=true; window.AYIRICI_URL="{AYIRICI_URL}";</script>\n{marker}')
Path(__file__).with_name("index.html").write_text(s, encoding="utf-8")
print("index.html oluşturuldu")
