"""Draws the menu-bar (tray) icons: python3 generate.py (writes tray.png, tray-attention.png).

Provenance: derived from the Gravita orbit mark (icons/app-icon.svg and the sidebar
Wordmark): a centre body and three orbit arcs over three quadrants, the fourth left open.
Template images are monochrome, so the three line colours become three arcs split by small
gaps. The attention variant adds a solid satellite in the open quadrant, where the app
icon keeps its moon: someone is waiting on you.

36 x 36 px: macOS draws status-bar images 18 pt tall, so this is exact at 2x and halves
cleanly at 1x. Black on transparent, rendered with 8 x 8 supersampling. No dependencies.
"""

import math
import struct
import zlib
from pathlib import Path

SIZE = 36
C = SIZE / 2
R = 13.0  # orbit radius
W = 3.4  # orbit stroke
BODY = 4.4  # centre body radius
SAT = 3.2  # satellite radius (attention)
SAT_ANGLE = 135.0  # degrees, clockwise from +x with y down (bottom-left quadrant)
SS = 8

cap = math.degrees((W / 2) / R)
gap = math.degrees(2.0 / R)  # ~2 px of air between arc caps
sweep = (270 - 2 * (2 * cap + gap)) / 3
ARCS = []
start = 180.0
for _ in range(3):
    ARCS.append((start, start + sweep))
    start += sweep + 2 * cap + gap


def in_arc(px, py, a0, a1):
    dx, dy = px - C, py - C
    ang = math.degrees(math.atan2(dy, dx)) % 360
    lo, hi = a0 % 360, a1 % 360
    inside = lo <= ang <= hi if lo <= hi else (ang >= lo or ang <= hi)
    if inside:
        return abs(math.hypot(dx, dy) - R) <= W / 2
    for a in (a0, a1):
        ex, ey = C + R * math.cos(math.radians(a)), C + R * math.sin(math.radians(a))
        if math.hypot(px - ex, py - ey) <= W / 2:
            return True
    return False


def covered(px, py, attention):
    if math.hypot(px - C, py - C) <= BODY:
        return True
    if any(in_arc(px, py, a0, a1) for a0, a1 in ARCS):
        return True
    if attention:
        sx = C + R * math.cos(math.radians(SAT_ANGLE))
        sy = C + R * math.sin(math.radians(SAT_ANGLE))
        return math.hypot(px - sx, py - sy) <= SAT
    return False


def render(attention):
    rows = []
    for y in range(SIZE):
        row = bytearray([0])  # filter: none
        for x in range(SIZE):
            hits = sum(
                covered(x + (i + 0.5) / SS, y + (j + 0.5) / SS, attention)
                for i in range(SS)
                for j in range(SS)
            )
            row += bytes([0, 0, 0, round(255 * hits / (SS * SS))])
        rows.append(bytes(row))
    return b"".join(rows)


def png(pixels):
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(pixels, 9))
        + chunk(b"IEND", b"")
    )


here = Path(__file__).parent
(here / "tray.png").write_bytes(png(render(False)))
(here / "tray-attention.png").write_bytes(png(render(True)))
