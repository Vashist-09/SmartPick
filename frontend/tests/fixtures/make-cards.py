"""Compose synthetic student-ID card images and simulated camera frames.

Everything here is fictional: the name, institution and identifiers are invented.
Usage: python3 make-cards.py   (reads ./raw/*.png from make-barcodes.cjs, writes ./cards and ./frames)
"""
import os, random
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
RAW, CARDS, FRAMES = (os.path.join(HERE, d) for d in ('raw', 'cards', 'frames'))
os.makedirs(CARDS, exist_ok=True); os.makedirs(FRAMES, exist_ok=True)
random.seed(7)

def font(size):
    for p in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'):
        if os.path.exists(p): return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def card(barcode_name, label):
    """CR80-proportioned card (85.6 x 54 mm at 10 px/mm) with the barcode near the bottom."""
    c = Image.new('RGB', (856, 540), (236, 242, 236))
    d = ImageDraw.Draw(c)
    d.rectangle([0, 0, 856, 96], fill=(27, 77, 62))
    d.text((28, 26), 'EXAMPLE INSTITUTE (SYNTHETIC)', font=font(30), fill=(227, 243, 93))
    d.rectangle([28, 122, 208, 352], fill=(190, 200, 190))  # photo placeholder
    d.text((236, 130), 'TEST STUDENT', font=font(34), fill=(30, 40, 34))
    d.text((236, 184), f'Reg. No: {label}', font=font(26), fill=(60, 70, 64))
    d.text((236, 228), 'Valid: 2026-2027', font=font(22), fill=(90, 100, 94))
    bc = Image.open(os.path.join(RAW, barcode_name + '.png')).convert('RGB')
    is2d = bc.width / bc.height < 2.2 or 'maxicode' in barcode_name
    target_w = 200 if is2d else 520
    bc = bc.resize((target_w, round(bc.height * target_w / bc.width)), Image.NEAREST)
    if not is2d: bc = bc.resize((bc.width, 110), Image.NEAREST)
    c.paste(bc, ((856 - bc.width) // 2 if not is2d else 620, 540 - bc.height - 26))
    return c

def scene(img, card_w=760, angle=0.0, center=(640, 360), bg=(70, 60, 52)):
    """Place a card in a 1280x720 'camera' frame."""
    f = Image.new('RGB', (1280, 720), bg)
    k = img.resize((card_w, round(img.height * card_w / img.width)), Image.LANCZOS).convert('RGBA')
    if angle: k = k.rotate(angle, expand=True, resample=Image.BICUBIC)
    f.paste(k, (center[0] - k.width // 2, center[1] - k.height // 2), k)
    return f

def perspective(img, skew=0.18):
    w, h = img.size
    # Map a trapezoid -> rectangle to simulate a card tilted away from the camera.
    coeffs = find_coeffs([(0, 0), (w, 0), (w, h), (0, h)], [(w * skew, h * 0.06), (w * (1 - skew * 0.3), 0), (w, h), (0, h * 0.94)])
    return img.transform((w, h), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=(70, 60, 52))

def find_coeffs(pa, pb):
    import numpy as np
    m = []
    for p1, p2 in zip(pa, pb):
        m.append([p1[0], p1[1], 1, 0, 0, 0, -p2[0] * p1[0], -p2[0] * p1[1]])
        m.append([0, 0, 0, p1[0], p1[1], 1, -p2[1] * p1[0], -p2[1] * p1[1]])
    A = np.array(m, dtype=float); B = np.array(pb, dtype=float).reshape(8)
    return np.linalg.solve(A, B).tolist()

def glare(img):
    g = Image.new('L', img.size, 0); d = ImageDraw.Draw(g)
    d.ellipse([img.width * 0.15, img.height * 0.1, img.width * 0.45, img.height * 0.55], fill=210)
    g = g.filter(ImageFilter.GaussianBlur(60))
    return Image.composite(Image.new('RGB', img.size, (255, 255, 255)), img, g)

def noise(img, amount=18):
    px = img.load()
    for y in range(0, img.height):
        for x in range(0, img.width):
            r, g, b = px[x, y]; n = random.randint(-amount, amount)
            px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    return img

cards = {
    'code128-24CS104': '24CS104', 'code128-0012345': '0012345', 'code39-24CS104': '24CS104',
    'qr-24CS104': '24CS104', 'pdf417-24CS104': '24CS104', 'code128-UNKNOWN99': '99ZZ999',
    'code128-lower-24cs104': '24cs104', 'code128-bad-chars': '24CS104;DROP', 'aztec-24CS104': '24CS104', 'maxicode-24CS104': '24CS104',
}
for name, label in cards.items():
    card(name, label).save(os.path.join(CARDS, name + '.png'))

base = card('code128-24CS104', '24CS104')
frames = {
    'straight': scene(base),
    # Barcode sits well below the vertical centre of the frame (card held low).
    'off-center-low': scene(base, card_w=640, center=(640, 470)),
    'angled-12deg': scene(base, angle=12),
    'angled-minus-12deg': scene(base, angle=-12),
    'angled-25deg': scene(base, angle=25),
    'perspective': perspective(scene(base)),
    'far-small': scene(base, card_w=470),
    'blurred': scene(base).filter(ImageFilter.GaussianBlur(1.6)),
    'low-contrast': ImageEnhance.Contrast(scene(base)).enhance(0.35),
    'low-light': noise(ImageEnhance.Brightness(scene(base)).enhance(0.38), 14),
    'glare': glare(scene(base)),
    'upside-down': scene(base, angle=180),
    'no-barcode': scene(Image.new('RGB', (856, 540), (236, 242, 236))),
    'heavily-damaged': scene(base).filter(ImageFilter.GaussianBlur(7)),
}
for k, v in frames.items():
    v.save(os.path.join(FRAMES, k + '.png'))
print('cards:', len(cards), 'frames:', len(frames))
