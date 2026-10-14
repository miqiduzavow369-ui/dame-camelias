#!/usr/bin/env python3
"""Build 24 deterministic, compact premium Telegram cards (black + gold)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT=Path("assets/balance_cards")
ROOT.mkdir(parents=True,exist_ok=True)
FONT_BOLD="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
def f(sz,bold=True):return ImageFont.truetype(FONT_BOLD if bold else FONT_REG,sz)
def centered(d,txt,y,font,color):
    bbox=d.textbbox((0,0),txt,font=font)
    d.text(((960-(bbox[2]-bbox[0]))//2,y),txt,font=font,fill=color)
def build(kind,n):
    # Consistent proportions of the existing DAME CAMELIAS account cards.
    bg=(19,15,13); gold=(218,173,101); cream=(248,226,192); muted=(194,163,116)
    image=Image.new("RGB",(960,340),bg)
    d=ImageDraw.Draw(image)
    d.rounded_rectangle((9,9,950,330),radius=32,outline=(120,86,48),width=6)
    d.rounded_rectangle((21,21,938,318),radius=24,outline=gold,width=3)
    centered(d,"DAME CAMELIAS",41,f(39),gold)
    d.line((170,109,790,109),fill=(112,82,48),width=2)
    if kind=="balance":
        centered(d,"ВАМ ДОСТУПНО",122,f(29),cream)
    else:
        centered(d,"ДЛЯ ЭТОЙ АНКЕТЫ СЕГОДНЯ",123,f(26),cream)
    centered(d,str(n),158,f(96),gold)
    centered(d,("ПУБЛИКАЦИЯ" if n==1 else "ПУБЛИКАЦИИ" if 2<=n<=4 else "ПУБЛИКАЦИЙ"),276,f(25),muted)
    name=(f"balance_{n:02d}.png" if kind=="balance" else f"daily_{n}.png")
    image.save(ROOT/name,format="PNG",optimize=True)
for x in range(21):build("balance",x)
for x in range(3):build("daily",x)
print("Created",len(list(ROOT.glob("*.png"))),"cards")
