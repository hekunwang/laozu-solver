"""Offline maintainer utility. The original font is an input, never a web asset.

Use the existing project-approved Python with Pillow and numpy; no downloads.
Example: /absolute/python build-talent-glyphs.py --font /path/FZCY.original.ttf
"""
import argparse
import base64
import gzip
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


def build(font_path, size=20):
    root = Path(__file__).resolve().parent
    abilities = json.loads((root / 'data/Ability.json').read_text())
    acquired = json.loads((root / 'data/acquired-talents.json').read_text())
    words = [dict(name=r['szName'], id=r['iAbilityID'], quality=r['iQuality'],
                  kind='innate' if r['iType'] == 4 else 'exclude')
             for r in abilities if r['iLevel'] == 0 and r.get('szName')]
    words += [dict(name=r['name'], id=r['id'], quality=r['quality'], kind='acquired')
              for r in acquired]
    aliases = root / 'data/acquired-talent-aliases.json'
    if aliases.exists():
        words += [dict(**row, kind='acquired') for row in json.loads(aliases.read_text())]
    # Include negative/empty labels to avoid nearest-word forced matches.
    words += [dict(name=name, id=-i-1, quality=0, kind='exclude') for i, name in enumerate(
        ['先天特性', '后天仙缘', '共鸣神通', '弟子详情', '仙缘不足', '天赋不足',
         '未获得', '可替换', '尚未获得'])]
    for word in words:
        word['name'] = word['name'].replace('\u200b', '')
    chars = ''.join(sorted(set(''.join(w['name'] for w in words))))
    font = ImageFont.truetype(str(font_path), 48)
    bounds = [font.getbbox(c, anchor='ls') for c in chars]
    y0, y1 = min(b[1] for b in bounds), max(b[3] for b in bounds)
    width = round(font.getlength('国'))
    masks = []
    for c in chars:
        im = Image.new('L', (width, y1-y0))
        ImageDraw.Draw(im).text((0, -y0), c, font=font, fill=255, anchor='ls')
        yy, xx = np.where(np.asarray(im) > 90)
        if not len(xx):
            raise ValueError('Missing glyph: ' + c)
        tight = im.crop((int(xx.min()), int(yy.min()), int(xx.max()+1), int(yy.max()+1)))
        if tight.width/tight.height > 2.5:
            scale = (size-2)/max(tight.width, tight.height)
            w, h = max(1, round(tight.width*scale)), max(1, round(tight.height*scale))
            small = Image.new('L', (size, size))
            small.paste(tight.resize((w, h), Image.Resampling.BILINEAR), ((size-w)//2, (size-h)//2))
        else:
            small = tight.resize((size, size), Image.Resampling.BILINEAR)
        masks.append(np.asarray(small))
    values = np.rint(np.stack(masks).astype(np.float32)/85).clip(0, 3).astype(np.uint8).reshape(-1)
    packed = (values[0::4] << 6) | (values[1::4] << 4) | (values[2::4] << 2) | values[3::4]
    result = dict(version=1, engine='talent-lite', size=size, bits=2, chars=chars,
                  data=base64.b64encode(packed.tobytes()).decode(), words=words)
    encoded = json.dumps(result, ensure_ascii=False, separators=(',', ':')).encode()
    target = root / 'data/talent-glyphs.json'
    target.write_bytes(encoded)
    print(json.dumps(dict(file=str(target), chars=len(chars), words=len(words),
                         bytes=len(encoded), gzipBytes=len(gzip.compress(encoded))), ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--font', required=True, type=Path)
    parser.add_argument('--size', type=int, choices=[16, 20, 24], default=20)
    args = parser.parse_args()
    build(args.font, args.size)
