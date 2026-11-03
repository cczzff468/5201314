'use client';

/**
 * X论坛 · 帖子数据动态增长引擎（用户规格一：模拟真实时间流）。
 *
 * 用户发帖后，浏览/点赞/转推从 0 起步，随「时间流任务」随机、缓慢地增长：
 * - 【触发点】① 每次刷新页面/打开论坛（boot catch-up：把离线期间错过的
 *   虚拟滚动补算回来，45 分钟一滚、封顶 40 滚≈30h）；② 页面开着时由
 *   ForumScheduler 心跳驱动，每 20 分钟活跃滚一次；
 * - 【热度】每帖发帖时抽定热度潜质 pot（15% 爆款 1.6~2.2 / 35% 温和 0.8~1.3 /
 *   50% 冷清 0.25~0.6，懒初始化写回 post.growth 永久跟随），再叠加真实网友
 *   点赞热度（likes 越多长得越快）；
 * - 【长尾效应】增速随帖龄衰减：<0.5h×1.0 → <2h×0.7 → <6h×0.45 → <12h×0.25
 *   → <24h×0.12 → <48h×0.05 → <72h×0.02 → ≥72h 停止；
 * - 【增长面】views（+3~30/滚）、likeBoost（+1~8/滚）、reposts（偶发）、
 *   大号 userFollowerBoost（帖子热度带来的自然涨粉）、评论区偶发一条新网友回复
 *   （走既有 replyToUserPost 管线，LLM 真写内容）；
 * - 【范围】仅用户帖（大号+匿名小号都是「用户发的」）；AI 帖生成时已带满额
 *   数据，不参与时间流。未到时间的定时帖不参与（还没「发出来」）。
 *
 * 本模块被 ForumScheduler（15s 心跳）与 forum.tsx（App 打开）调用；
 * 内部节流（LIVE_MS），重复调用安全幂等。
 */
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import {
  ANON_KEY,
  createDynNpc,
  forumData,
  isUserAuthor,
  likesOf,
  mutateForum,
  uid,
  type ForumPost,
} from './core';
import { addPending, runPending } from './engine';

// ---------------- 参数 ----------------

/** 离线补算的虚拟滚动间隔（45 分钟一滚） */
const ROLL_MS = 45 * 60_000;
/** 在线活跃滚动间隔（页面开着时 20 分钟一滚） */
const LIVE_MS = 20 * 60_000;
/** 单次补算最多滚数（40 滚 ≈ 30 小时窗口；更早的按 72h 停止规则自然归零） */
const MAX_ROLLS = 40;
/** 全局节流游标 kv 键 */
const LAST_ROLL_KEY = 'forum-growth-v1:lastr';
/** 单帖评论区增长上限（超过就不再补新评论——真实帖子长尾也不会无限盖楼） */
const GROWTH_COMMENT_CAP = 5;
/** 单轮 tick 触发「补一条新评论」的总概率 */
const COMMENT_CHANCE = 0.12;

/** 发帖热度潜质（15% 爆款 / 35% 温和 / 50% 冷清） */
function drawPot(): number {
  const r = Math.random();
  if (r < 0.15) return 1.6 + Math.random() * 0.6;
  if (r < 0.5) return 0.8 + Math.random() * 0.5;
  return 0.25 + Math.random() * 0.35;
}

/** 帖龄衰减因子（长尾效应） */
function ageFactor(ageH: number): number {
  if (ageH < 0.5) return 1;
  if (ageH < 2) return 0.7;
  if (ageH < 6) return 0.45;
  if (ageH < 12) return 0.25;
  if (ageH < 24) return 0.12;
  if (ageH < 48) return 0.05;
  if (ageH < 72) return 0.02;
  return 0; // 72h 后停止
}

/** 本次滚动时间点序列（离线补算虚拟滚） */
function rollTimes(last: number, now: number): number[] {
  const elapsed = Math.max(0, now - last);
  let n = Math.floor(elapsed / ROLL_MS);
  if (n > MAX_ROLLS) n = MAX_ROLLS;
  if (n <= 0) {
    // 未满一个离线滚周期：只要过了 LIVE_MS 就做一次「实时滚」（now 点位）
    return elapsed >= LIVE_MS ? [now] : [];
  }
  const out: number[] = [];
  for (let i = 1; i <= n; i++) out.push(Math.min(last + i * ROLL_MS, now));
  return out;
}

// ---------------- 主入口 ----------------

let ticking = false;

/** 时间流 tick：ForumScheduler 心跳（节流内自动跳过）+ forum App 打开（force=true）。
 *  幂等：并发/重复调用直接返回；force 也受 2 分钟最小间隔保护（防快速重挂载抖动）。 */
export function tickForumGrowth(force = false): void {
  try {
    if (ticking) return;
    const now = Date.now();
    let last = kvGet<number>(LAST_ROLL_KEY) ?? 0;
    // 首次运行（从未滚过）：基线 = 现在——没有任何可补算的历史，别把滚点
    // 落到 1970（否则 40 个虚拟滚全部早于一切帖子，白跑一趟）
    if (last <= 0) last = now;
    if (now - last < (force ? 2 * 60_000 : LIVE_MS)) return; // 节流
    const rolls = rollTimes(last, now);
    if (!rolls.length) return;
    ticking = true;
    try {
      applyGrowth(rolls, now);
      kvSet(LAST_ROLL_KEY, now); // 游标推进到本次（余量并入下次，防重复计数）
    } finally {
      ticking = false;
    }
  } catch {
    ticking = false;
  }
}

// ---------------- 增长应用 ----------------

/** 对全部用户帖应用一轮滚动 */
function applyGrowth(rolls: number[], now: number): void {
  const d0 = forumData();
  if (!d0.seeded) return;

  let followBoost = 0;
  /** 评论区增长候选（id 列表；本轮最多 1 条——评论是 LLM 成本件，省着用） */
  const commentEligible: string[] = [];

  mutateForum((next) => {
    for (const p of next.posts) {
      if (!isUserAuthor(p.authorKey)) continue;
      if (typeof p.visibleAt === 'number' && p.visibleAt > now) continue; // 定时帖未发布
      // 热度潜质懒初始化（发帖时没写，第一次见到它时抽定并写回，永久跟随）
      if (!p.growth) p.growth = { pot: drawPot() };
      // 真实热度乘数：网友真实点赞越多长得越快（封顶 +50%）
      const hm = 1 + Math.min(50, likesOf(p)) / 100;
      for (const rt of rolls) {
        if (rt < p.createdAt) continue; // 帖子只从发布时刻起增长（补算滚点早于发帖的直接跳过）
        const f = ageFactor((rt - p.createdAt) / 3600_000);
        if (f <= 0) continue;
        const pot = p.growth.pot;
        // 浏览：+3~30 基数（低因子时 50% 概率歇一拍——长尾的「偶尔才动一下」）
        if (f >= 0.15 || Math.random() < 0.5) {
          p.views += Math.max(1, Math.round((3 + Math.random() * 27) * f * pot * hm));
        }
        // 点赞：+1~8 基数，结果 <1 时 30% 概率仍然 +1（别让冷帖完全死水）
        const likeInc = Math.round((1 + Math.random() * 7) * f * pot * hm);
        if (likeInc >= 1 || Math.random() < 0.3) {
          p.likeBoost = (p.likeBoost ?? 0) + Math.max(1, likeInc);
        }
        // 转推：偶发
        const rpInc = Math.floor(Math.random() * 2.2 * f * pot * hm);
        if (rpInc >= 1) p.reposts += rpInc;
        // 自然涨粉（仅大号帖；匿名小号不产生关注者资产）
        if (p.authorKey !== ANON_KEY && Math.random() < 0.12 * f * pot) followBoost++;
      }
      // 评论区增长候选登记（<48h 且未达上限；是否触发在 mutateForum 外统一抽签）
      if (
        now - p.createdAt < 48 * 3600_000 &&
        next.posts.filter((x) => x.replyTo === p.id).length < GROWTH_COMMENT_CAP
      ) {
        commentEligible.push(p.id);
      }
    }
    if (followBoost > 0) next.userFollowerBoost = (next.userFollowerBoost ?? 0) + followBoost;
  });

  // 评论区偶发补一条新网友回复（长尾里的「过几天还有人翻到」）：
  // 本轮整体以 COMMENT_CHANCE 概率触发一次；createDynNpc 会落盘，放 mutateForum 外
  if (commentEligible.length && Math.random() < COMMENT_CHANCE) {
    try {
      const d = forumData();
      const pid = commentEligible[Math.floor(Math.random() * commentEligible.length)];
      const target = d.posts.find((x) => x.id === pid);
      if (!target) return;
      const commenter = createDynNpc();
      addPending({
        id: uid('j'),
        due: Date.now() + 30_000 + Math.random() * 240_000,
        kind: 'replyToUserPost',
        postKey: target.id,
        meta: { authorKey: commenter, parentContent: target.content.slice(0, 200) },
      });
      runPending();
    } catch {
      /* 静默 */
    }
  }
}
