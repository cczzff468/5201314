#!/usr/bin/env python3
"""去白边处理：边缘洪泛填充去背景 + 保留大连通域去水印 + 轻羽化 → 透明 PNG 骑手形象"""
import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter, ImageOps

UP = Path('/home/z/my-project/upload')
OUT = Path('/home/z/my-project/public/mt/riders')

JOBS = [
    ('Camera_XHS_17913755755691040g00831gqfd9qiju5g5o6n73gg86d9eh0iflo.jpg', 'r10.png'),  # 钱钱：抱钱袋小白
    ('Camera_XHS_17913756934111040g2sg3160fc3p3gmd04aepfb1ikaqvbrrk6lg.jpg', 'r11.png'),  # 熊熊：KFC头盔小熊
    ('Camera_XHS_17913757668181040g00832287jcsv70n05nro150g8iprd7a7858.jpg', 'r12.png'),  # 笑笑：笑眯眯小鸡
    ('Camera_XHS_17913757691201040g00832287jcsv70ng5nro150g8iprakujqc8.jpg', 'r13.png'),  # 馋馋：吃饼干小鸡
    ('Camera_XHS_17913757731251040g00832287jcsv70o05nro150g8iprn60rhjo.jpg', 'r14.png'),  # 嗨嗨：挥手小鸡
    ('Camera_XHS_1791375890341notes_pre_post_1040g3k831hps29h83qk05pk9u9ojuu46ht08vp0.jpg', 'r15.png'),  # 喵喵：骑车载白猫
    ('Camera_XHS_1791375892803notes_pre_post_1040g3k831hps29h83qkg5pk9u9ojuu46krddtmg.jpg', 'r16.png'),  # 嘟嘟：骑车载小熊
    ('Camera_XHS_17913760424821040g008316i08lfp0s6g5oscbr891ed7uvetmg0.jpg', 'r17.png'),  # 兔兔：黄头盔兔兔
]

TOL = 46  # 与背景色的最大色距

# 用户需求：懒懒r11/一二r15/布布r16/兔兔r17 朝左 → 镜像成朝右
FLIP_TO_RIGHT = {'r11', 'r15', 'r16', 'r17'}


def process(src: Path, dst: Path) -> None:
    im = Image.open(src).convert('RGB')
    w, h = im.size
    px = im.load()

    # 1) 背景色 = 四边中点/角像素的中位色
    border = []
    for x in range(0, w, max(1, w // 60)):
        border += [px[x, 0], px[x, h - 1]]
    for y in range(0, h, max(1, h // 60)):
        border += [px[0, y], px[w - 1, y]]
    border.sort(key=lambda c: sum(c))
    bg = border[len(border) // 2]

    # 2) 从边缘洪泛：所有与背景色相近的连通像素 → 透明（只清外部，不吃角色身上的白）
    removed = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if dist(px[x, y], bg) < TOL and not removed[y * w + x]:
                removed[y * w + x] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if dist(px[x, y], bg) < TOL and not removed[y * w + x]:
                removed[y * w + x] = 1
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not removed[ny * w + nx]:
                if dist(px[nx, ny], bg) < TOL:
                    removed[ny * w + nx] = 1
                    q.append((nx, ny))

    # 3) 连通域：非透明像素里保留面积 ≥3% 最大域的域（去水印/角标，保留小挂饰）
    label = [0] * (w * h)
    sizes = {}
    lid = 0
    for i in range(w * h):
        if removed[i] or label[i]:
            continue
        lid += 1
        cnt = 0
        q = deque([i])
        label[i] = lid
        while q:
            j = q.popleft()
            cnt += 1
            x, y = j % w, j // w
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h:
                    k = ny * w + nx
                    if not removed[k] and not label[k]:
                        label[k] = lid
                        q.append(k)
        sizes[lid] = cnt
    if sizes:
        biggest = max(sizes.values())
        for i in range(w * h):
            if not removed[i] and label[i] and sizes[label[i]] < biggest * 0.03:
                removed[i] = 1

    # 3.5) 右下角水印专项：独立小域且整体落在右下角 32%×22% 区域、颜色浅（min 通道 >175）→ 删除
    #      （角色主体域 bbox 横跨全图不受影响；黄色小挂饰因 B 通道低而保留）
    seen = set()
    for i in range(w * h):
        lid = label[i]
        if removed[i] or not lid or lid in seen:
            continue
        seen.add(lid)
        xs = [j % w for j in range(w * h) if label[j] == lid]
        ys = [j // w for j in range(w * h) if label[j] == lid]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        if x0 >= w * 0.68 and y0 >= h * 0.78 and sizes[lid] < biggest * 0.25:
            cols = [px[j % w, j // w] for j in range(w * h) if label[j] == lid]
            if min(min(c) for c in cols) > 175:
                for j in range(w * h):
                    if label[j] == lid:
                        removed[j] = 1

    # 4) alpha 通道（removed=1 → 透明）+ 轻羽化 + 裁剪 + 缩放
    alpha = Image.frombytes('L', (w, h), bytes(0 if b else 255 for b in removed))
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.9))
    rgba = im.convert('RGBA')
    rgba.putalpha(alpha)
    bbox = alpha.getbbox()
    if bbox:
        m = 6
        bbox = (max(0, bbox[0] - m), max(0, bbox[1] - m), min(w, bbox[2] + m), min(h, bbox[3] + m))
        rgba = rgba.crop(bbox)
    if max(rgba.size) > 420:
        r = 420 / max(rgba.size)
        rgba = rgba.resize((round(rgba.width * r), round(rgba.height * r)), Image.LANCZOS)
    if dst.stem in FLIP_TO_RIGHT:
        rgba = ImageOps.mirror(rgba)
    rgba.save(dst, 'PNG')
    print(f'{dst.name}: {rgba.size} bg={bg}')


def dist(a, b):
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])


for name, out in JOBS:
    process(UP / name, OUT / out)
print('ALL DONE')
