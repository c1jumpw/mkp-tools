"""Generates abstract cover art for the guide's sample library (600x600 JPEGs + a 1200x675 banner).

VERSION HISTORY
  v1  2026-10-30  Nine square covers and one collection banner.
  v2  2026-11-22  Moved to c3jumpw/mkp-tools/pdl/guide-src.
"""
import math, os, sys
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
S = 600

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def vgrad(w, h, top, bottom):
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):
        d.line([(0, y), (w, y)], fill=lerp(top, bottom, y / (h - 1)))
    return im

def grain(im, amt=10):
    import random
    random.seed(7)
    px = im.load()
    w, h = im.size
    for _ in range(w * h // 6):
        x, y = random.randrange(w), random.randrange(h)
        r, g, b = px[x, y]
        n = random.randint(-amt, amt)
        px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    return im

BRASS = (201, 161, 94)
CREAM = (236, 229, 216)
INK = (23, 19, 16)

def layers():  # Four Layers of Wealth
    im = vgrad(S, S, (40, 30, 22), (18, 14, 11))
    d = ImageDraw.Draw(im)
    cols = [(201, 161, 94), (168, 128, 70), (122, 92, 55), (78, 60, 40)]
    for i, c in enumerate(cols):
        y = 150 + i * 80
        d.rounded_rectangle([110 + i * 22, y, 490 - i * 22, y + 56], radius=10, fill=c)
    return im

def rings():  # High Achiever OS
    im = vgrad(S, S, (30, 38, 44), (14, 18, 22))
    d = ImageDraw.Draw(im)
    for i, r in enumerate([230, 175, 120, 65]):
        d.ellipse([300 - r, 300 - r, 300 + r, 300 + r], outline=lerp(BRASS, (120, 150, 160), i / 3), width=14)
    d.ellipse([280, 280, 320, 320], fill=BRASS)
    return im

def lever():  # Stop pushing boulders, build levers
    im = vgrad(S, S, (54, 40, 30), (22, 17, 13))
    d = ImageDraw.Draw(im)
    d.polygon([(250, 430), (300, 360), (350, 430)], fill=(122, 92, 55))
    d.line([(90, 300), (520, 410)], fill=BRASS, width=16)
    d.ellipse([60, 190, 190, 320], fill=(150, 112, 70))
    d.rectangle([0, 430, S, S], fill=(30, 24, 18))
    return im

def door():  # Leadership starts in an empty room
    im = vgrad(S, S, (26, 22, 20), (12, 10, 9))
    glow = Image.new("RGB", (S, S), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.polygon([(240, 140), (360, 140), (470, 560), (130, 560)], fill=(120, 92, 52))
    glow = glow.filter(ImageFilter.GaussianBlur(28))
    im = Image.blend(im, Image.eval(glow, lambda v: v), 0.55)
    d = ImageDraw.Draw(im)
    d.rectangle([240, 140, 360, 380], fill=(236, 214, 170))
    d.rectangle([240, 140, 360, 380], outline=BRASS, width=6)
    return im

def sunrise():  # Morning visualization
    im = vgrad(S, S, (70, 48, 34), (201, 150, 92))
    d = ImageDraw.Draw(im)
    d.ellipse([170, 300, 430, 560], fill=(245, 218, 160))
    d.rectangle([0, 430, S, S], fill=(36, 28, 22))
    for i in range(4):
        d.line([(60, 470 + i * 28), (540, 470 + i * 28)], fill=(70, 54, 40), width=4)
    return im

def brain():  # Bypassing the brain's bouncer
    im = vgrad(S, S, (44, 30, 36), (18, 13, 15))
    d = ImageDraw.Draw(im)
    for i in range(9):
        a = i / 9 * math.pi * 2
        x, y = 300 + 170 * math.cos(a), 300 + 170 * math.sin(a)
        d.line([(300, 300), (x, y)], fill=(120, 84, 90), width=6)
        d.ellipse([x - 22, y - 22, x + 22, y + 22], fill=BRASS if i % 3 == 0 else (160, 116, 108))
    d.ellipse([255, 255, 345, 345], fill=CREAM)
    return im

def bio():  # Absolute biological requirements
    im = vgrad(S, S, (28, 40, 32), (12, 18, 14))
    d = ImageDraw.Draw(im)
    pts = []
    for x in range(40, 561, 4):
        y = 300 + 110 * math.sin((x - 40) / 520 * math.pi * 3) * math.exp(-((x - 300) / 300) ** 2)
        pts.append((x, y))
    d.line(pts, fill=(150, 190, 150), width=12, joint="curve")
    d.line([(pt[0], pt[1] + 40) for pt in pts], fill=BRASS, width=6, joint="curve")
    return im

def arch():  # Internal architecture
    im = vgrad(S, S, (36, 34, 44), (16, 15, 20))
    d = ImageDraw.Draw(im)
    for i in range(5):
        x = 120 + i * 90
        d.rectangle([x, 160 + (i % 2) * 50, x + 50, 470], fill=lerp((90, 88, 120), BRASS, i / 4))
    d.rectangle([90, 470, 510, 494], fill=CREAM)
    return im

def calm():  # Affirmations
    im = vgrad(S, S, (34, 44, 50), (16, 20, 24))
    d = ImageDraw.Draw(im)
    for i in range(5):
        y = 220 + i * 45
        pts = [(x, y + 18 * math.sin(x / 70 + i)) for x in range(40, 561, 6)]
        d.line(pts, fill=lerp((140, 170, 175), BRASS, i / 4), width=7, joint="curve")
    return im

def banner():
    w, h = 1200, 675
    im = vgrad(w, h, (58, 40, 30), (205, 152, 92))
    d = ImageDraw.Draw(im)
    d.ellipse([440, 360, 760, 680], fill=(246, 222, 168))
    d.polygon([(0, 520), (260, 400), (520, 500), (800, 380), (1200, 520), (1200, 675), (0, 675)], fill=(44, 33, 25))
    d.polygon([(0, 600), (380, 520), (760, 600), (1200, 540), (1200, 675), (0, 675)], fill=(28, 22, 17))
    return im

covers = {
    "four_layers": layers, "high_achiever": rings, "levers": lever, "empty_room": door,
    "sunrise": sunrise, "bouncer": brain, "biology": bio, "architecture": arch, "calm": calm,
}
for name, fn in covers.items():
    grain(fn().convert("RGB"), 6).save(os.path.join(OUT, name + ".jpg"), quality=86)
grain(banner(), 5).save(os.path.join(OUT, "banner.jpg"), quality=86)
print("ok", sorted(os.listdir(OUT)))
