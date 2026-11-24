"""Shrinks captured PNG screenshots to 640px-wide WebP for the guide, and copies shots.json.

usage: python3 to_webp.py <png_dir_from_capture> <shots_dir>

VERSION HISTORY
  v1  2026-11-22  Split out of the original one-off command.
"""
import os, shutil, sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
for name in sorted(os.listdir(src)):
    if name.endswith(".png"):
        im = Image.open(os.path.join(src, name)).convert("RGB")
        im = im.resize((640, round(im.height * 640 / im.width)), Image.LANCZOS)
        im.save(os.path.join(dst, name[:-4] + ".webp"), "WEBP", quality=80, method=6)
shutil.copy(os.path.join(src, "shots.json"), os.path.join(dst, "shots.json"))
print("done")
