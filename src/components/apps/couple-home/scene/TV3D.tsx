'use client';

/**
 * 情侣小家 3D —— 「美颜电视」（程序化建模，不用 GLB）
 *
 * - 超窄柔黑边框 + 1.8m 大屏，简约大气；
 * - 上墙支架（默认布局挂在电视柜上方墙面）；
 * - 开机：动态彩屏（Canvas 渐变流动画面）+ 前场柔光 + 电视背后氛围背光
 *   （bias lighting，夜里在墙上映出柔光晕，非常出片）；
 * - 关机：深邃镜面黑屏；
 * - 开关带淡入淡出（damp 过渡），支架颜色跟随用户调色；
 * - v10 频道全家桶：1 流光云朵 / 2 啵啵新闻 / 3 音乐台 / 4 天气台（实时读天气总线，
 *   室外天气变了画面自动变）/ 5 风景相册台（4 张程序化风景轮播）/ 6 喵喵台（猫咪小剧场）。
 */

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { HomeWeather } from '../types';
import { weatherBusGet } from './weather-bus';

export interface TV3DProps {
  /** 开机 */
  on: boolean;
  /** 夜晚（夜里背光更浓） */
  night: boolean;
  /** 用户自选颜色（作用于支架与边框背面） */
  col?: string;
  /** 频道（1=流光云朵 2=啵啵新闻 3=音乐台 4=天气台 5=风景相册台 6=喵喵台；undefined = 流光） */
  channel?: number;
}

/** 屏幕动态画面：频道制（1 流光云朵 / 2 啵啵新闻 / 3 音乐台 / 4 天气台 / 5 风景相册 / 6 喵喵台），换台即重建纹理 */
function makeScreenTexture(channel: number): { tex: THREE.CanvasTexture; draw: (t: number) => void } {
  const W = 256;
  const H = 152;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;

  const blobs = [
    { c: '244,182,198', r: 0.55, sx: 0.9, sy: 0.62, px: 0.0, py: 0.55 }, // 樱粉
    { c: '168,203,219', r: 0.62, sx: 0.55, sy: 0.9, px: 0.33, py: 0.25 }, // 天青
    { c: '243,214,150', r: 0.42, sx: 0.75, sy: 0.75, px: 0.75, py: 0.8 }, // 杏黄
  ];

  // —— v10 新频道（4/5/6）公用小工具（闭包内建一次，draw 里复用，不每帧 new） ——
  /** 星星固定点位（x, y, 半径）—— 天气台夜空 / 相册台星空共用 */
  const STARS: Array<[number, number, number]> = [
    [18, 16, 1.1], [42, 34, 0.9], [58, 12, 1.3], [82, 26, 0.8], [104, 44, 1.0],
    [124, 18, 1.2], [148, 36, 0.9], [166, 10, 1.1], [186, 30, 0.8], [236, 52, 1.0],
    [26, 54, 0.8], [210, 60, 0.9], [66, 66, 0.7], [140, 58, 0.8],
  ];
  /** 圆角矩形路径（arcTo 手绘） */
  const rrect = (x: number, y: number, w: number, h: number, r: number) => {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  };
  /** 右上角小圆角台标（白字半透明底，v10 新频道统一风格） */
  const badge = (label: string) => {
    ctx.font = '800 12px system-ui, sans-serif';
    const bw = ctx.measureText(label).width + 14;
    ctx.fillStyle = 'rgba(16,19,24,0.4)';
    rrect(W - bw - 7, 7, bw, 19, 9.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.fillText(label, W - bw, 20);
  };
  /** 一朵卡通云（几个圆拼合 + 平底） */
  const cloud = (cx: number, cy: number, s: number, c: string) => {
    ctx.fillStyle = c;
    const puff = (px: number, py: number, pr: number) => {
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
    };
    puff(cx - s * 0.95, cy + s * 0.22, s * 0.5);
    puff(cx - s * 0.18, cy - s * 0.2, s * 0.68);
    puff(cx + s * 0.6, cy, s * 0.56);
    puff(cx + s * 0.08, cy + s * 0.26, s * 0.5);
    ctx.fillRect(cx - s * 0.9, cy + s * 0.05, s * 1.8, s * 0.42);
  };
  /** 云横向漂移位置（t 驱动、按序号错开，循环出屏） */
  const drift = (t2: number, i: number, speed: number) => ((t2 * speed + i * 97) % (W + 90)) - 45;
  /** 实心三角形 */
  const tri = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.closePath();
    ctx.fill();
  };
  /** 频道 4 天气台：天气名 / 大字主题色 / 温度区间（天气变化时固定区间随机一次，稳定显示） */
  const W_NAME: Record<HomeWeather, string> = { sunny: '晴', cloudy: '多云', overcast: '阴', rain: '雨', snow: '雪' };
  const W_COLOR: Record<HomeWeather, string> = { sunny: '#e8a13c', cloudy: '#5a8fb8', overcast: '#7d8a97', rain: '#5f87b0', snow: '#8fb6d8' };
  const W_TEMP: Record<HomeWeather, [number, number]> = { sunny: [23, 27], cloudy: [18, 23], overcast: [14, 19], rain: [12, 17], snow: [-3, 2] };
  let tempW: HomeWeather | null = null;
  let tempVal = 24;
  const todayTemp = (w: HomeWeather) => {
    if (w !== tempW) {
      const rng = W_TEMP[w];
      tempVal = Math.round(rng[0] + Math.random() * (rng[1] - rng[0]));
      tempW = w;
    }
    return tempVal;
  };
  /** 频道 5 相册台：松树 / 樱花树 */
  const pine = (x: number, y: number, s: number) => {
    ctx.fillStyle = '#7a5a40';
    ctx.fillRect(x - s * 0.08, y - s * 0.24, s * 0.16, s * 0.26);
    ctx.fillStyle = '#3e6b4c';
    tri(x, y - s * 1.5, x - s * 0.5, y - s * 0.6, x + s * 0.5, y - s * 0.6);
    ctx.fillStyle = '#47775a';
    tri(x, y - s * 1.14, x - s * 0.42, y - s * 0.38, x + s * 0.42, y - s * 0.38);
    ctx.fillStyle = '#528565';
    tri(x, y - s * 0.8, x - s * 0.32, y - s * 0.1, x + s * 0.32, y - s * 0.1);
  };
  const sakuraTree = (x: number, y: number, s: number) => {
    ctx.fillStyle = '#8a6248';
    ctx.fillRect(x - s * 0.07, y - s * 0.62, s * 0.14, s * 0.64);
    const blob = (bx: number, by: number, br: number, c: string) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
    };
    blob(x - s * 0.34, y - s * 0.74, s * 0.33, '#ffb0c9');
    blob(x + s * 0.32, y - s * 0.8, s * 0.35, '#ffc4d6');
    blob(x + s * 0.02, y - s, s * 0.38, '#ffcada');
    blob(x + s * 0.04, y - s * 0.58, s * 0.28, '#f79fbd');
  };
  /** 频道 5 相册台：四张程序化风景（海滩日落 / 雪山松林 / 樱花原野 / 星空夜湖） */
  const beach = (tt: number) => {
    const g = ctx.createLinearGradient(0, 0, 0, 88);
    g.addColorStop(0, '#5d4d94');
    g.addColorStop(0.45, '#d8756a');
    g.addColorStop(0.8, '#f5a86a');
    g.addColorStop(1, '#ffd9a0');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, 88);
    // 落日光晕 + 半沉太阳
    const g2 = ctx.createRadialGradient(W * 0.5, 84, 4, W * 0.5, 84, 62);
    g2.addColorStop(0, 'rgba(255,224,150,0.9)');
    g2.addColorStop(1, 'rgba(255,224,150,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, 88);
    ctx.fillStyle = '#ffcf7a';
    ctx.beginPath();
    ctx.arc(W * 0.5, 84, 19, 0, Math.PI * 2);
    ctx.fill();
    // 海面
    const g3 = ctx.createLinearGradient(0, 88, 0, H);
    g3.addColorStop(0, '#e79a6f');
    g3.addColorStop(0.4, '#b96a6e');
    g3.addColorStop(1, '#4a3d75');
    ctx.fillStyle = g3;
    ctx.fillRect(0, 88, W, H - 88);
    // 太阳倒影波光（闪烁横线）
    for (let i = 0; i < 12; i++) {
      const yy = 93 + i * 5;
      const w5 = Math.max(4, 44 - i * 3.2);
      const sh = Math.max(0.06, 0.28 + 0.3 * Math.sin(tt * 2.1 + i * 1.35));
      ctx.strokeStyle = `rgba(255,216,150,${sh})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(W * 0.5 - w5 / 2 + Math.sin(tt + i) * 4, yy);
      ctx.lineTo(W * 0.5 + w5 / 2 + Math.sin(tt * 1.3 + i * 2.1) * 4, yy);
      ctx.stroke();
    }
    // 海面碎光
    for (let i = 0; i < 8; i++) {
      const yy = 94 + ((i * 29) % 58);
      const sh = Math.max(0.03, 0.18 + 0.16 * Math.sin(tt * 1.7 + i * 2.4));
      ctx.strokeStyle = `rgba(255,255,255,${sh})`;
      ctx.lineWidth = 1;
      const xx = 24 + ((i * 71) % (W - 60));
      ctx.beginPath();
      ctx.moveTo(xx, yy);
      ctx.lineTo(xx + 14 + (i % 3) * 6, yy);
      ctx.stroke();
    }
  };
  const snowMountain = (tt: number) => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#a9cfe8');
    g.addColorStop(1, '#e9f3f9');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 远山两座
    ctx.fillStyle = '#8fb4d0';
    tri(-14, 98, 84, 30, 182, 98);
    ctx.fillStyle = '#a3c2d8';
    tri(112, 98, 198, 44, 276, 98);
    // 背光面
    ctx.fillStyle = 'rgba(120,150,185,0.3)';
    tri(84, 30, 182, 98, 148, 98);
    tri(198, 44, 276, 98, 246, 98);
    // 雪顶
    ctx.fillStyle = '#f7fbfe';
    tri(54, 50.8, 84, 30, 114, 50.8);
    tri(168.4, 62.6, 198, 44, 224.9, 62.6);
    // 雪原
    const g2 = ctx.createLinearGradient(0, 96, 0, H);
    g2.addColorStop(0, '#f2f8fc');
    g2.addColorStop(1, '#dce9f2');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 96, W, H - 96);
    // 远处 + 近处松树
    pine(88, 106, 10);
    pine(160, 104, 9);
    pine(24, 122, 26);
    pine(52, 130, 20);
    pine(196, 124, 24);
    pine(226, 132, 18);
    pine(120, 144, 30);
    // 微风飘雪
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 10; i++) {
      const sy2 = (tt * 16 + i * 37) % H;
      const sx2 = ((i * 61 + 20) % W) + Math.sin(tt + i) * 5;
      ctx.beginPath();
      ctx.arc(sx2, sy2, 1 + (i % 2) * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const sakuraField = (tt: number) => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#ffeef3');
    g.addColorStop(1, '#ffe0eb');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 远山淡影
    ctx.fillStyle = 'rgba(219,178,201,0.55)';
    tri(-24, 94, 72, 46, 158, 94);
    tri(96, 94, 196, 52, 288, 94);
    // 草地
    const g2 = ctx.createLinearGradient(0, 94, 0, H);
    g2.addColorStop(0, '#aed795');
    g2.addColorStop(1, '#7db869');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 94, W, H - 94);
    // 三棵樱花树
    sakuraTree(48, 118, 40);
    sakuraTree(190, 112, 34);
    sakuraTree(120, 140, 52);
    // 花瓣飘落（左右摇摆）
    for (let i = 0; i < 16; i++) {
      const py = (tt * 19 + i * 41) % 148;
      const px = ((i * 53 + 17) % W) + Math.sin(tt * 1.7 + i * 0.85) * 11;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,168,196,0.9)' : 'rgba(255,205,220,0.9)';
      ctx.beginPath();
      ctx.ellipse(px, py, 2.4, 1.4, tt * 1.2 + i, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const starLake = (tt: number) => {
    const g = ctx.createLinearGradient(0, 0, 0, 86);
    g.addColorStop(0, '#0d1330');
    g.addColorStop(1, '#2a3660');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, 86);
    // 星星（微闪）
    for (let i = 0; i < STARS.length; i++) {
      const sd = STARS[i];
      ctx.fillStyle = `rgba(240,240,220,${0.35 + 0.5 * (0.5 + 0.5 * Math.sin(tt * 1.8 + i * 1.3))})`;
      ctx.beginPath();
      ctx.arc(sd[0], sd[1], sd[2], 0, Math.PI * 2);
      ctx.fill();
    }
    // 月亮 + 光晕
    const mx = 196;
    const my = 26;
    const g2 = ctx.createRadialGradient(mx, my, 2, mx, my, 34);
    g2.addColorStop(0, 'rgba(243,238,203,0.55)');
    g2.addColorStop(1, 'rgba(243,238,203,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(mx - 34, my - 34, 68, 68);
    ctx.fillStyle = '#f3eecb';
    ctx.beginPath();
    ctx.arc(mx, my, 9.5, 0, Math.PI * 2);
    ctx.fill();
    // 山影
    ctx.fillStyle = '#151d3e';
    tri(-16, 86, 66, 40, 142, 86);
    tri(104, 86, 182, 48, 264, 86);
    // 湖面
    const g3 = ctx.createLinearGradient(0, 86, 0, H);
    g3.addColorStop(0, '#202e58');
    g3.addColorStop(1, '#0e1734');
    ctx.fillStyle = g3;
    ctx.fillRect(0, 86, W, H - 86);
    // 月光倒影（闪烁横线）
    for (let i = 0; i < 7; i++) {
      const yy = 92 + i * 9;
      const sh = Math.max(0.05, 0.3 + 0.25 * Math.sin(tt * 2.3 + i * 1.5));
      ctx.strokeStyle = `rgba(243,238,203,${sh})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mx - 8 + Math.sin(tt + i) * 3, yy);
      ctx.lineTo(mx + 8 + Math.sin(tt * 1.4 + i * 2) * 3, yy);
      ctx.stroke();
    }
    // 星星倒影（零星短竖线）
    for (let i = 0; i < STARS.length; i += 2) {
      const sd = STARS[i];
      const yy = 88 + sd[1] * 0.7;
      if (yy > H - 5) continue;
      ctx.strokeStyle = `rgba(240,240,220,${0.12 + 0.1 * Math.sin(tt * 1.6 + i)})`;
      ctx.lineWidth = 1;
      const xx = sd[0] + Math.sin(tt + i) * 1.5;
      ctx.beginPath();
      ctx.moveTo(xx, yy);
      ctx.lineTo(xx, yy + 3.5);
      ctx.stroke();
    }
  };
  const slides: Array<(tt: number) => void> = [beach, snowMountain, sakuraField, starLake];

  const draw = (t: number) => {
    // 深底
    ctx.fillStyle = '#101318';
    ctx.fillRect(0, 0, W, H);
    if (channel === 2) {
      // —— 频道 2「啵啵新闻」：深蓝演播室 + 旋转地球 + 底部滚动条 ——
      const g2 = ctx.createLinearGradient(0, 0, 0, H);
      g2.addColorStop(0, '#1b2c4a');
      g2.addColorStop(1, '#101a30');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, W, H);
      // 旋转地球（橙黄经纬线）
      const ex = W * 0.78;
      const ey = H * 0.4;
      const er = W * 0.13;
      ctx.strokeStyle = 'rgba(243,214,150,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ex, ey, er, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const ph = (t * 0.5 + i / 3) % 1;
        const rx = er * Math.abs(Math.cos(ph * Math.PI));
        ctx.beginPath();
        ctx.ellipse(ex, ey, Math.max(1.5, rx), er, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (let i = 0; i < 4; i++) {
        const lat = ey + (i - 1.5) * er * 0.45;
        ctx.beginPath();
        ctx.ellipse(ex, lat, er * Math.sqrt(Math.max(0.05, 1 - ((lat - ey) / er) ** 2)), er * 0.14, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(243,214,150,0.22)';
      ctx.beginPath();
      ctx.arc(ex, ey, er + 6, 0, Math.PI * 2);
      ctx.fill();
      // 标题条 + 滚动字幕
      ctx.fillStyle = '#f2a9bc';
      ctx.fillRect(0, H * 0.72, W, H * 0.14);
      ctx.fillStyle = '#fff7f9';
      ctx.font = '900 20px system-ui, sans-serif';
      ctx.fillText('LIVE', W * 0.05, H * 0.815);
      const scroll = ((t * 46) % (W + 190)) - 150;
      ctx.fillText('小家新闻：今天也是甜甜的一天', scroll, H * 0.815);
      // 台标
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = '900 17px system-ui, sans-serif';
      ctx.fillText('啵啵台', W * 0.06, H * 0.2);
    } else if (channel === 3) {
      // —— 频道 3「音乐台」：暗紫底 + 跳动均衡器 ——
      const g3 = ctx.createLinearGradient(0, 0, 0, H);
      g3.addColorStop(0, '#241a38');
      g3.addColorStop(1, '#151024');
      ctx.fillStyle = g3;
      ctx.fillRect(0, 0, W, H);
      const bars = 14;
      const bw = W / (bars * 1.6);
      for (let i = 0; i < bars; i++) {
        const v = 0.22 + Math.abs(Math.sin(t * 2.6 + i * 0.9) * Math.cos(t * 1.3 + i * 0.4)) * 0.62;
        const bh = v * H * 0.62;
        const hue = 330 + Math.sin(i * 0.6 + t * 0.5) * 30;
        ctx.fillStyle = `hsl(${hue}, 62%, 68%)`;
        const x = (i + 0.3) * (W / bars) + bw * 0.2;
        ctx.fillRect(x, H * 0.82 - bh, bw, bh);
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fillRect(x, H * 0.82 - bh - 5, bw, 3);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '900 17px system-ui, sans-serif';
      ctx.fillText('♪ 拾光电台', W * 0.06, H * 0.16);
    } else if (channel === 4) {
      // —— 频道 4「天气台」：每帧实时读天气总线，室外天气变了画面自动跟着变 ——
      const wb = weatherBusGet();
      const w = wb.weather;
      const wNight = wb.night;
      const SKY_H = H * 0.6;
      const BAN_Y = H * 0.66;
      const BAN_H = H * 0.26;
      // 天空底色（夜晚深蓝，白天按天气）
      const g4 = ctx.createLinearGradient(0, 0, 0, SKY_H);
      if (wNight) {
        g4.addColorStop(0, '#101a36');
        g4.addColorStop(1, '#26325a');
      } else if (w === 'sunny') {
        g4.addColorStop(0, '#7fc3ea');
        g4.addColorStop(1, '#d3ebf8');
      } else if (w === 'cloudy') {
        g4.addColorStop(0, '#9fb7c9');
        g4.addColorStop(1, '#e0eaf0');
      } else if (w === 'overcast') {
        g4.addColorStop(0, '#8b95a1');
        g4.addColorStop(1, '#c6cdd5');
      } else if (w === 'rain') {
        g4.addColorStop(0, '#5c6b7d');
        g4.addColorStop(1, '#9aa9b7');
      } else {
        g4.addColorStop(0, '#b9c3cd');
        g4.addColorStop(1, '#ecf0f4');
      }
      ctx.fillStyle = g4;
      ctx.fillRect(0, 0, W, SKY_H);
      // 地面（雪天积雪白，雪夜蓝灰，夜晚暗绿）
      const g4g = ctx.createLinearGradient(0, SKY_H, 0, H);
      if (w === 'snow' && !wNight) {
        g4g.addColorStop(0, '#f4f8fb');
        g4g.addColorStop(1, '#dee8ef');
      } else if (w === 'snow') {
        g4g.addColorStop(0, '#46506b');
        g4g.addColorStop(1, '#2e3548');
      } else if (wNight) {
        g4g.addColorStop(0, '#26321f');
        g4g.addColorStop(1, '#161f14');
      } else {
        g4g.addColorStop(0, '#8fbf7a');
        g4g.addColorStop(1, '#5d8f4e');
      }
      ctx.fillStyle = g4g;
      ctx.fillRect(0, SKY_H, W, H - SKY_H);
      // 夜空：星星 + 月亮；白天晴天：旋转光芒太阳
      if (wNight) {
        for (let i = 0; i < STARS.length; i++) {
          const sd = STARS[i];
          ctx.fillStyle = `rgba(240,240,215,${0.4 + 0.45 * (0.5 + 0.5 * Math.sin(t * 2.4 + i * 1.7))})`;
          ctx.beginPath();
          ctx.arc(sd[0], sd[1], sd[2], 0, Math.PI * 2);
          ctx.fill();
        }
        const mx = W * 0.8;
        const my = SKY_H * 0.36;
        const g4m = ctx.createRadialGradient(mx, my, 2, mx, my, 30);
        g4m.addColorStop(0, 'rgba(243,238,203,0.5)');
        g4m.addColorStop(1, 'rgba(243,238,203,0)');
        ctx.fillStyle = g4m;
        ctx.fillRect(mx - 30, my - 30, 60, 60);
        ctx.fillStyle = '#f3eecb';
        ctx.beginPath();
        ctx.arc(mx, my, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(120,120,90,0.18)';
        ctx.beginPath();
        ctx.arc(mx - 3.5, my - 2.5, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(mx + 4, my + 3.5, 1.8, 0, Math.PI * 2);
        ctx.fill();
      } else if (w === 'sunny') {
        const sx = W * 0.8;
        const sy = SKY_H * 0.38;
        const sr = 15;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(t * 0.55);
        ctx.fillStyle = 'rgba(255,214,120,0.8)';
        for (let i = 0; i < 8; i++) {
          ctx.rotate(Math.PI / 4);
          ctx.beginPath();
          ctx.moveTo(sr * 0.72, -3);
          ctx.lineTo(sr * 1.85, 0);
          ctx.lineTo(sr * 0.72, 3);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
        const g4s = ctx.createRadialGradient(sx, sy, 2, sx, sy, sr * 1.8);
        g4s.addColorStop(0, 'rgba(255,240,180,0.95)');
        g4s.addColorStop(1, 'rgba(255,240,180,0)');
        ctx.fillStyle = g4s;
        ctx.fillRect(sx - sr * 2, sy - sr * 2, sr * 4, sr * 4);
        ctx.fillStyle = '#ffd76e';
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fill();
      }
      // 云层（各天气不同层数/颜色，夜晚压暗）
      const clN = 'rgba(118,128,155,0.9)';
      if (w === 'sunny') {
        cloud(drift(t, 0, 7), 24, 11, wNight ? clN : 'rgba(255,255,255,0.92)');
        cloud(drift(t, 1, 5), 44, 9, wNight ? clN : 'rgba(255,255,255,0.85)');
      } else if (w === 'cloudy') {
        cloud(drift(t, 0, 5), 20, 15, wNight ? clN : 'rgba(255,255,255,0.7)');
        cloud(drift(t, 1, 6), 40, 13, wNight ? clN : 'rgba(255,255,255,0.78)');
        cloud(drift(t, 2, 4), 12, 12, wNight ? clN : 'rgba(255,255,255,0.88)');
        cloud(drift(t, 3, 8), 30, 10, wNight ? clN : 'rgba(255,255,255,0.96)');
        cloud(drift(t, 4, 5.5), 48, 9, wNight ? clN : 'rgba(255,255,255,0.85)');
      } else if (w === 'overcast') {
        cloud(drift(t, 0, 4), 14, 15, '#aeb6bf');
        cloud(drift(t, 1, 3.2), 34, 14, '#a0a9b3');
        cloud(drift(t, 2, 4.6), 52, 13, '#b7bfc8');
        cloud(drift(t, 3, 3.6), 24, 13, '#98a2ad');
        cloud(drift(t, 4, 5.2), 44, 12, '#a8b1bb');
        cloud(drift(t, 5, 2.8), 6, 12, '#9aa4af');
      } else if (w === 'rain') {
        cloud(drift(t, 0, 4), 16, 14, '#76828f');
        cloud(drift(t, 1, 3.2), 30, 13, '#6a7683');
        cloud(drift(t, 2, 4.4), 6, 12, '#818d9a');
        // 斜落雨丝
        ctx.strokeStyle = wNight ? 'rgba(160,180,205,0.5)' : 'rgba(205,222,238,0.65)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < 26; i++) {
          const ry = (t * 135 + i * 37) % (SKY_H - 8);
          const rx = ((i * 41 + 9) % (W + 26)) - 13 - ry * 0.32;
          ctx.moveTo(rx, ry);
          ctx.lineTo(rx - 2.2, ry + 8.5);
        }
        ctx.stroke();
        // 地面涟漪
        for (let i = 0; i < 5; i++) {
          const rp = (t * 0.85 + i * 0.21) % 1;
          ctx.strokeStyle = `rgba(255,255,255,${(1 - rp) * 0.5})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(26 + i * 52, SKY_H + 5 + (i % 2) * 2.5, 2 + rp * 9, (2 + rp * 9) * 0.3, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else {
        // snow：飘雪 + 积雪地面
        cloud(drift(t, 0, 3.4), 16, 14, wNight ? '#8b96a8' : '#dfe6ee');
        cloud(drift(t, 1, 2.8), 32, 12, wNight ? '#808b9d' : '#eef2f6');
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        for (let i = 0; i < 24; i++) {
          const sy2 = (t * 24 + i * 41) % (SKY_H + 4);
          const sx2 = ((i * 47 + 13) % W) + Math.sin(t * 1.5 + i * 0.8) * 7;
          ctx.beginPath();
          ctx.arc(sx2, sy2 - 2, 1 + (i % 3) * 0.55, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.ellipse(44, SKY_H + 6, 26, 4.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(150, SKY_H + 8, 34, 5.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(226, SKY_H + 5, 22, 4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // —— 下半屏：天气预报栏目条 ——
      const g4b = ctx.createLinearGradient(0, BAN_Y, 0, BAN_Y + BAN_H);
      g4b.addColorStop(0, 'rgba(255,255,255,0.94)');
      g4b.addColorStop(1, 'rgba(226,238,247,0.94)');
      ctx.fillStyle = g4b;
      rrect(7, BAN_Y, W - 14, BAN_H, 10);
      ctx.fill();
      ctx.fillStyle = '#5aa7d8';
      ctx.fillRect(16, BAN_Y + 8, 4, BAN_H - 16);
      ctx.fillStyle = '#4a7fae';
      ctx.font = '800 10px system-ui, sans-serif';
      ctx.fillText('天气预报 · 拾光气象台', 27, BAN_Y + 15);
      ctx.font = '900 25px system-ui, sans-serif';
      ctx.fillStyle = W_COLOR[w];
      ctx.fillText(W_NAME[w], 25, BAN_Y + BAN_H - 8);
      ctx.font = '600 9px system-ui, sans-serif';
      ctx.fillStyle = '#8a97a4';
      ctx.fillText('今日温度', W - 62, BAN_Y + 15);
      ctx.font = '900 21px system-ui, sans-serif';
      ctx.fillStyle = '#e2708a';
      const tempStr = `${todayTemp(w)}°`;
      ctx.fillText(tempStr, W - 20 - ctx.measureText(tempStr).width, BAN_Y + BAN_H - 8);
      badge('天气');
    } else if (channel === 5) {
      // —— 频道 5「风景相册台」：4 张程序化风景轮播，6s 一张、末尾 0.9s 淡入淡出 ——
      const p5 = t / 6;
      const idx5 = Math.floor(p5) % 4;
      const f5 = p5 - Math.floor(p5);
      slides[idx5](t);
      const FADE = 0.9;
      const fTh = 1 - FADE / 6;
      if (f5 > fTh) {
        ctx.globalAlpha = (f5 - fTh) / (FADE / 6);
        slides[(idx5 + 1) % 4](t);
        ctx.globalAlpha = 1;
      }
      // 右下角小相框角标
      const fx = W - 30;
      const fy = H - 27;
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      rrect(fx, fy, 23, 19, 3);
      ctx.fill();
      ctx.save();
      rrect(fx + 2.5, fy + 2.5, 18, 14, 2);
      ctx.clip();
      const g5f = ctx.createLinearGradient(0, fy + 2, 0, fy + 17);
      g5f.addColorStop(0, '#8ec9e8');
      g5f.addColorStop(0.62, '#f6e3b2');
      g5f.addColorStop(0.63, '#8fbf7a');
      g5f.addColorStop(1, '#5d8f4e');
      ctx.fillStyle = g5f;
      ctx.fillRect(fx + 2, fy + 2, 19, 15);
      ctx.fillStyle = '#f2b25c';
      ctx.beginPath();
      ctx.arc(fx + 15, fy + 7, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      badge('相册');
    } else if (channel === 6) {
      // —— 频道 6「喵喵台」：奶油猫草地小剧场 ——
      const g6 = ctx.createLinearGradient(0, 0, 0, H);
      g6.addColorStop(0, '#aee3f2');
      g6.addColorStop(0.52, '#dff2e0');
      g6.addColorStop(0.54, '#8ec96f');
      g6.addColorStop(1, '#5f9e4a');
      ctx.fillStyle = g6;
      ctx.fillRect(0, 0, W, H);
      // 小太阳 + 飘云
      ctx.fillStyle = '#ffe08a';
      ctx.beginPath();
      ctx.arc(30, 26, 11, 0, Math.PI * 2);
      ctx.fill();
      cloud(drift(t, 2, 5), 40, 9, 'rgba(255,255,255,0.9)');
      // 小草
      ctx.strokeStyle = 'rgba(60,120,50,0.55)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const gx = (i * 37 + 11) % W;
        const gy = 96 + ((i * 23) % 46);
        ctx.moveTo(gx, gy + 5);
        ctx.quadraticCurveTo(gx + 1.5, gy, gx + 3.5, gy + 4);
      }
      ctx.stroke();
      // 猫走位（7s 一趟左右往返）+ 扑跳（每 5s 跳 0.9s）
      const ph6 = (t % 7) / 7;
      const going = ph6 < 0.5;
      const u6 = going ? ph6 * 2 : (1 - ph6) * 2;
      const cx6 = 44 + u6 * (W - 88);
      const dir = going ? 1 : -1;
      const jp6 = t % 5;
      const jump = jp6 < 0.9 ? Math.sin((jp6 / 0.9) * Math.PI) : 0;
      const groundY = H * 0.8;
      const cy6 = groundY - 16 - jump * 24 - Math.abs(Math.sin(t * 7)) * 2;
      // 影子（跳起时缩小变淡）
      ctx.fillStyle = `rgba(40,80,40,${0.18 - jump * 0.07})`;
      ctx.beginPath();
      ctx.ellipse(cx6, groundY + 2, 19 - jump * 7, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // 毛线球（猫旁边滚动，带拖线）
      const byx = cx6 + dir * 30;
      const byy = groundY - 6 - Math.abs(Math.sin(t * 6.5)) * 4;
      ctx.strokeStyle = '#d97a76';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(byx - dir * 6, byy + 3);
      ctx.quadraticCurveTo(byx - dir * 16, byy + 6, byx - dir * 22, byy + 1 + Math.sin(t * 3) * 2);
      ctx.stroke();
      ctx.save();
      ctx.translate(byx, byy);
      ctx.rotate(dir * t * 4.2);
      ctx.fillStyle = '#ef8f8a';
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(190,80,80,0.65)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.ellipse(0, 0, 7, 2.7, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, 7, 2.7, 1.05, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, 7, 2.7, -1.05, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      // —— 猫本尊（圆头 + 三角耳 + 豆豆眼 + w 嘴，奶油色，朝行进方向） ——
      ctx.save();
      ctx.translate(cx6, cy6);
      ctx.scale(dir, 1);
      // 尾巴（轻摆）
      ctx.strokeStyle = '#f0dfbd';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-13, 5);
      ctx.quadraticCurveTo(-22, 2, -24, -7 + Math.sin(t * 3.2) * 4);
      ctx.stroke();
      // 四条小短腿（走路摆动）
      const sw6 = Math.sin(t * 9) * 3.2;
      ctx.strokeStyle = '#e8d2a6';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(7, 7);
      ctx.lineTo(7 + sw6, 15);
      ctx.moveTo(-6, 7);
      ctx.lineTo(-6 - sw6, 15);
      ctx.stroke();
      // 身体 + 头
      ctx.fillStyle = '#f5e6c8';
      ctx.beginPath();
      ctx.ellipse(0, 4, 16, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(11, -9, 10.5, 0, Math.PI * 2);
      ctx.fill();
      // 三角耳（同色叠画无缝）+ 耳内粉
      ctx.beginPath();
      ctx.moveTo(3.5, -15);
      ctx.lineTo(5, -24);
      ctx.lineTo(11, -17.5);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(13, -18);
      ctx.lineTo(18.5, -25);
      ctx.lineTo(20.5, -15.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f6c2ca';
      ctx.beginPath();
      ctx.moveTo(6, -16.5);
      ctx.lineTo(6.8, -21);
      ctx.lineTo(9.8, -17.2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(14.4, -17.6);
      ctx.lineTo(17.8, -22);
      ctx.lineTo(18.8, -16.6);
      ctx.closePath();
      ctx.fill();
      // 豆豆眼 + 粉鼻 + w 嘴 + 腮红
      ctx.fillStyle = '#3a3a42';
      ctx.beginPath();
      ctx.arc(7.5, -10.5, 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(15, -10.5, 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f0939f';
      ctx.beginPath();
      ctx.arc(11.2, -7, 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#a5765c';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(9.6, -5.6, 1.7, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(12.9, -5.6, 1.7, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = 'rgba(246,170,180,0.55)';
      ctx.beginPath();
      ctx.arc(4.5, -6.5, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(18, -6.5, 2.4, 0, Math.PI * 2);
      ctx.fill();
      // 背部浅棕条纹
      ctx.strokeStyle = 'rgba(214,182,130,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-8, -4);
      ctx.quadraticCurveTo(-10, 2, -8, 8);
      ctx.moveTo(-3, -5.5);
      ctx.quadraticCurveTo(-5, 1, -3, 7.5);
      ctx.stroke();
      ctx.restore();
      // 头顶「喵~」气泡（4.2s 循环出现约 1s，淡入淡出）
      const bp6 = t % 4.2;
      if (bp6 < 1.05) {
        const a6 = Math.max(0, Math.min(1, bp6 < 0.15 ? bp6 / 0.15 : bp6 > 0.9 ? (1.05 - bp6) / 0.15 : 1));
        ctx.globalAlpha = a6;
        const bxx = cx6 + dir * 10;
        const byy2 = cy6 - 40;
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        rrect(bxx - 16, byy2 - 10, 32, 17, 8);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(bxx - 4, byy2 + 6);
        ctx.lineTo(bxx - 1, byy2 + 13);
        ctx.lineTo(bxx + 5, byy2 + 6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#e2708a';
        ctx.font = '900 12px system-ui, sans-serif';
        ctx.fillText('喵~', bxx - 11, byy2 + 3);
        ctx.globalAlpha = 1;
      }
      badge('喵喵');
    } else {
      // —— 频道 1「流光云朵」（默认）：三色流动光斑 + 弹跳小球 ——
      for (const b of blobs) {
        const x = (b.px + Math.sin(t * b.sx) * 0.18 + 1) * 0.5 * W;
        const y = (b.py + Math.cos(t * b.sy) * 0.16 + 1) * 0.5 * H;
        const r = b.r * W * 0.6;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(${b.c},0.85)`);
        g.addColorStop(1, `rgba(${b.c},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      // 弹跳小球（影子 + 反弹）
      const bx = (0.5 + Math.sin(t * 0.7) * 0.32) * W;
      const bp = (t * 0.9) % 1;
      const by = H * 0.72 - Math.abs(Math.sin(bp * Math.PI)) * H * 0.34;
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.ellipse(bx, H * 0.76, 14 - by / H * 4, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f7c66b';
      ctx.beginPath();
      ctx.arc(bx, by, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.beginPath();
      ctx.arc(bx - 3, by - 3, 4, 0, Math.PI * 2);
      ctx.fill();
      // 底部淡淡反光带（像画面里的地平线）
      const lg = ctx.createLinearGradient(0, H * 0.7, 0, H);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(1, 'rgba(255,255,255,0.10)');
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, W, H);
    }
    tex.needsUpdate = true;
  };
  draw(0);
  return { tex, draw };
}

/** 电视几何（原点 = 屏幕中心） */
const PANEL_W = 1.8;
const PANEL_H = 1.05;
const PANEL_T = 0.05;

export default function TV3D({ on, night, col, channel = 1 }: TV3DProps) {
  const screen = useMemo(() => makeScreenTexture(channel), [channel]);
  const screenMat = useRef<THREE.MeshStandardMaterial>(null);
  const frontGlow = useRef<THREE.PointLight>(null);
  const backGlow = useRef<THREE.PointLight>(null);
  const lastDraw = useRef(0);

  useFrame((state, dt) => {
    // 开关淡入淡出
    if (screenMat.current) {
      const target = on ? (night ? 1.45 : 1.0) : 0;
      screenMat.current.emissiveIntensity = THREE.MathUtils.damp(
        screenMat.current.emissiveIntensity,
        target,
        5,
        dt,
      );
    }
    // 画面流动（开机时 ~12fps 重绘即可）
    if (on && screenMat.current && screenMat.current.emissiveIntensity > 0.05) {
      const now = state.clock.elapsedTime;
      if (now - lastDraw.current > 0.08) {
        lastDraw.current = now;
        screen.draw(now);
      }
    }
    if (frontGlow.current) {
      frontGlow.current.intensity = THREE.MathUtils.damp(
        frontGlow.current.intensity,
        on ? (night ? 1.5 : 0.8) : 0,
        5,
        dt,
      );
    }
    if (backGlow.current) {
      backGlow.current.intensity = THREE.MathUtils.damp(
        backGlow.current.intensity,
        on ? (night ? 2.0 : 0.55) : 0,
        5,
        dt,
      );
    }
  });

  const frameColor = col ?? '#eceae4'; // 支架 / 背板颜色（可调色）

  return (
    <group>
      {/* —— 上墙支架（贴墙暗藏） —— */}
      <mesh position={[0, -0.1, -0.055]} castShadow>
        <boxGeometry args={[0.52, 0.34, 0.05]} />
        <meshStandardMaterial color={frameColor} roughness={0.7} />
      </mesh>

      {/* —— 屏幕（柔黑超窄边框） —— */}
      <mesh castShadow>
        <boxGeometry args={[PANEL_W, PANEL_H, PANEL_T]} />
        <meshStandardMaterial color="#24262b" roughness={0.45} metalness={0.15} />
      </mesh>

      {/* —— 画面（镜面黑 → 开机流光） —— */}
      <mesh position={[0, 0.012, PANEL_T / 2 + 0.004]}>
        <planeGeometry args={[PANEL_W - 0.1, PANEL_H - 0.09]} />
        <meshStandardMaterial
          ref={screenMat}
          color="#0b0d11"
          emissive="#ffffff"
          emissiveMap={screen.tex}
          emissiveIntensity={0}
          roughness={0.08}
          metalness={0.2}
        />
      </mesh>

      {/* —— 底边品牌小灯点 —— */}
      <mesh position={[0, -PANEL_H / 2 + 0.028, PANEL_T / 2 + 0.004]}>
        <circleGeometry args={[0.016, 12]} />
        <meshStandardMaterial color="#d8d8dc" emissive="#cfd4e0" emissiveIntensity={on ? 1.2 : 0} />
      </mesh>

      {/* —— 前场柔光（照亮客厅 / 沙发方向） —— */}
      <pointLight
        ref={frontGlow}
        position={[0, 0, 0.9]}
        color="#cfe0ff"
        intensity={0}
        distance={4.6}
        decay={2}
      />
      {/* —— 氛围背光（电视与墙之间的光晕，夜里最美） —— */}
      <pointLight
        ref={backGlow}
        position={[0, 0, -0.22]}
        color="#b9c4e8"
        intensity={0}
        distance={2.6}
        decay={2}
      />
    </group>
  );
}
