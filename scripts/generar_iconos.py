"""Genera los íconos de la app (PWA / APK). Se ejecuta una sola vez a mano; los PNG quedan guardados en visor_src/pwa/icons/.
   Diseño: un pivote de riego (círculo con sus cuadros), una ruta y el marcador de raja, igual que en el mapa."""
import os, sys
from PIL import Image, ImageDraw
SAL = os.path.join(os.path.dirname(__file__), '..', 'visor_src', 'pwa', 'icons')
VERDE, AMBAR, CIAN, ROJO, BLANCO = (29, 43, 34), (242, 177, 52), (34, 211, 238), (214, 40, 57), (255, 255, 255)

def dibujo(n, escala=1.0, fondo=True, mono=False, redondeo=0.0):
    """n = lado final en px; escala = tamaño del dibujo respecto al lienzo (0.62 para íconos 'maskable': la zona segura es el 80% central)."""
    S = n * 4                                   # se dibuja al cuádruple y se reduce: bordes suaves
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    if fondo:
        if redondeo: d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * redondeo), fill=VERDE + (255,))
        else: d.rectangle([0, 0, S, S], fill=VERDE + (255,))
    k = S * escala; ox = oy = (S - k) / 2
    P = lambda x, y: (ox + x * k, oy + y * k)                      # coordenadas del dibujo en [0,1]
    col = lambda c: BLANCO if mono else c
    # pivote: círculo con cuadros
    cx, cy, r = .5, .47, .36; w = max(int(k * .045), 2)
    d.ellipse([*P(cx - r, cy - r), *P(cx + r, cy + r)], outline=col(AMBAR), width=w, fill=None if mono else AMBAR + (46,))
    d.line([P(cx - r, cy), P(cx + r, cy)], fill=col(AMBAR), width=w); d.line([P(cx, cy - r), P(cx, cy + r)], fill=col(AMBAR), width=w)
    # ruta de entrada desde abajo a la izquierda hasta el borde del pivote
    d.line([P(.12, .93), P(.30, .80), P(.30, .70), P(.37, .62)], fill=col(CIAN), width=int(w * 1.5), joint='curve')
    # marcador de raja
    px, py, pr = .66, .30, .095
    d.ellipse([*P(px - pr, py - pr), *P(px + pr, py + pr)], fill=col(ROJO))
    d.polygon([P(px - pr * .8, py + pr * .55), P(px + pr * .8, py + pr * .55), P(px, py + pr * 2.05)], fill=col(ROJO))
    d.ellipse([*P(px - pr * .38, py - pr * .38), *P(px + pr * .38, py + pr * .38)], fill=(0, 0, 0, 0) if mono else BLANCO)
    return im.resize((n, n), Image.LANCZOS)

def guardar(nombre, im): im.save(os.path.join(SAL, nombre)); print(' ', nombre, im.size)
os.makedirs(SAL, exist_ok=True)
guardar('icon-192.png', dibujo(192, .86, redondeo=.2)); guardar('icon-512.png', dibujo(512, .86, redondeo=.2))
guardar('icon-maskable-512.png', dibujo(512, .62))                     # fondo a sangre; el dibujo cabe en la zona segura
guardar('icon-monochrome-512.png', dibujo(512, .62, fondo=False, mono=True))
a = dibujo(180, .74); fondo = Image.new('RGB', a.size, VERDE); fondo.paste(a, mask=a.split()[3]); guardar('apple-touch-icon.png', fondo)
