#!/usr/bin/env python3
"""
快递员形象图处理：去白边/浅蓝底（边缘泛洪填充）+ 裁切 + 输出透明 PNG 到 public/couriers/。
用边缘泛洪而非全局阈值——保留角色身上的白色（头盔/衣服）不被打穿。
"""
import os
from collections import deque
from PIL import Image, ImageOps
import numpy as np

SRC = '/home/z/my-project/upload'
OUT = '/home/z/my-project/public/couriers'
os.makedirs(OUT, exist_ok=True)

# id -> 上传文件名
COURIERS = {
    'truck':     '1791698774590.png',  # 小熊货车（默认运输车；原生朝右）
    'bunny':     '1791698742368.png',  # 橙兔摩托（朝左→镜像朝右）
    'rainbear':  '1791698768847.png',  # 雨天小熊（原生朝右）
    'polarbear': '1791698792961.png',  # 白熊小哥（朝左→镜像朝右）
    'duck':      '1791698944055.png',  # 鸭鸭三轮（朝左→镜像朝右）
    'redcat':    '1791698986961.png',  # 红帽咪咪（朝左→镜像朝右）
    'pinkcat':   '1791699001644.png',  # 粉车咪咪（朝左→镜像朝右）
    'bluebear':  '1791699006325.png',  # 蓝车熊熊（朝左→镜像朝右）
    'rabbit':    '1791698737419.png',  # 帽帽兔（朝左→镜像朝右）
}

# 用户需求：快递员统一朝右（物流地图巡航方向左→右）；原生朝右的 truck/rainbear 不翻转
FLIP_TO_RIGHT = {'bunny', 'polarbear', 'duck', 'redcat', 'pinkcat', 'bluebear', 'rabbit'}

TOL = 42          # 与背景色的最大色距（0-441）
ALPHA_EDGE = 210  # 距离超过此值的边缘邻接像素半透明化，柔化白边


def remove_bg(img: Image.Image) -> Image.Image:
    im = img.convert('RGBA')
    w, h = im.size
    px = np.asarray(im).astype(np.int16)
    rgb = px[..., :3]
    # 背景种子色 = 四角 8x8 区域中位数
    corners = np.concatenate([
        rgb[:8, :8].reshape(-1, 3), rgb[:8, -8:].reshape(-1, 3),
        rgb[-8:, :8].reshape(-1, 3), rgb[-8:, -8:].reshape(-1, 3),
    ])
    bg = np.median(corners, axis=0)

    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=-1))
    bg_like = dist < TOL

    # 从四边泛洪：只清除与边缘连通的背景
    visit = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if bg_like[y, x] and not visit[y, x]:
                visit[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if bg_like[y, x] and not visit[y, x]:
                visit[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y-1, x), (y+1, x), (y, x-1), (y, x+1)):
            if 0 <= ny < h and 0 <= nx < w and not visit[ny, nx] and bg_like[ny, nx]:
                visit[ny, nx] = True
                q.append((ny, nx))

    alpha = np.where(visit, 0, 255).astype(np.uint8)

    # 柔化边缘：透明区邻接的不透明像素降一些 alpha（去白边硬线）
    trans = alpha == 0
    near = np.zeros((h, w), dtype=bool)
    near[1:, :] |= trans[:-1, :]; near[:-1, :] |= trans[1:, :]
    near[:, 1:] |= trans[:, :-1]; near[:, :-1] |= trans[:, 1:]
    edge_soft = near & (alpha > 0) & (dist < TOL + 60)
    alpha[edge_soft] = ALPHA_EDGE

    out = px.copy()
    out[..., 3] = alpha
    return Image.fromarray(out.astype(np.uint8), 'RGBA')


def process(name: str, fname: str):
    src = os.path.join(SRC, fname)
    img = Image.open(src)
    cleaned = remove_bg(img)
    # 裁到内容包围盒（留 4px 呼吸边）
    bbox = cleaned.getbbox()
    if bbox:
        l, t, r, b = bbox
        pad = 4
        l = max(0, l - pad); t = max(0, t - pad)
        r = min(cleaned.width, r + pad); b = min(cleaned.height, b + pad)
        cleaned = cleaned.crop((l, t, r, b))
    # 限宽 420
    if cleaned.width > 420:
        nh = round(cleaned.height * 420 / cleaned.width)
        cleaned = cleaned.resize((420, nh), Image.LANCZOS)
    # 朝向统一：朝左的角色水平镜像成朝右（用户需求）
    if name in FLIP_TO_RIGHT:
        cleaned = ImageOps.mirror(cleaned)
    dst = os.path.join(OUT, f'{name}.png')
    cleaned.save(dst, optimize=True)
    print(f'{name}: {fname} -> {dst} {cleaned.size}')


for k, v in COURIERS.items():
    process(k, v)
print('done')
