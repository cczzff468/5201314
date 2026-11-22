'use client';

/**
 * 淘宝系页面通用「双向刷新」基建（Task 40 需求，Task 45 语义升级）：
 * - 顶部下拉、底部上拉，两个方向都触发 onRefresh(dir)，调用方按方向分流；
 * - 顶部下拉（down）→ 新内容前插到列表顶部，旧内容一律原位保留、不重排、不清空；
 * - 底部上拉（up）→ 新内容追加到列表底部（加载更多）：上方内容（含之前刷新出来的）原位不变，
 *   追加不改变现有内容高度，无需视口锚定，画面完全不跳；
 * - TbPullIndicator 悬浮胶囊：下拉在顶部随手指位移，上拉在底部（文案「加载」），加载中转圈。
 */

import { useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

export type TbPullDir = 'down' | 'up';

/** 双向刷新 Hook：bind 展开到滚动容器上，scrollRef 接滚动容器；onRefresh 可返回 Promise（等 AI 生成完再收尾） */
export function useTbPullRefresh(onRefresh: (dir: TbPullDir) => void | Promise<void>, opts?: { downThreshold?: number; upThreshold?: number; delay?: number }) {
  const cb = useRef(onRefresh);
  cb.current = onRefresh;
  const downTH = opts?.downThreshold ?? 44;
  const upTH = opts?.upThreshold ?? 56;
  const delay = opts?.delay ?? 620;

  const [refreshing, setRefreshing] = useState<TbPullDir | null>(null);
  const [ghost, setGhost] = useState<{ dir: TbPullDir; dist: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const st = useRef({ y: 0, dir: 'down' as TbPullDir, active: false, dist: 0 });
  const busy = useRef(false);

  const onTouchStart = (e: React.TouchEvent) => {
    const el = scrollRef.current;
    if (!el || busy.current) {
      st.current.active = false;
      return;
    }
    if (el.scrollTop <= 0) st.current = { y: e.touches[0].clientY, dir: 'down', active: true, dist: 0 };
    else if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) st.current = { y: e.touches[0].clientY, dir: 'up', active: true, dist: 0 };
    else st.current.active = false;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = st.current;
    if (!s.active) return;
    const dy = s.y - e.touches[0].clientY; // 手指向上 dy>0
    const raw = s.dir === 'down' ? -dy : dy;
    s.dist = Math.max(0, raw);
    setGhost(s.dist > 10 ? { dir: s.dir, dist: Math.min(80, s.dist * 0.5) } : null);
  };
  const onTouchEnd = () => {
    const s = st.current;
    if (s.active && !busy.current && s.dist > (s.dir === 'down' ? downTH : upTH)) {
      busy.current = true;
      const dir = s.dir;
      setGhost(null);
      setRefreshing(dir);
      window.setTimeout(() => {
        const finish = () => {
          // up=底部追加：现有内容高度不变、视口自然不动；down=前插：视口在顶部同样不动。
          // 双 rAF 等 React 提交新内容后再收尾
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              setRefreshing(null);
              busy.current = false;
            }),
          );
        };
        // Task 41：刷新回调返回 Promise（AI 生成）时等它完成再收尾，「正在刷新」不提前消失
        const ret = cb.current(dir) as unknown;
        if (ret && typeof (ret as Promise<void>).then === 'function') {
          (ret as Promise<void>).then(finish, finish);
        } else {
          finish();
        }
      }, delay);
    } else {
      setGhost(null);
    }
    st.current.active = false;
    st.current.dist = 0;
  };

  return { scrollRef, refreshing, ghost, bind: { onTouchStart, onTouchMove, onTouchEnd } };
}

export type TbPullRefresh = ReturnType<typeof useTbPullRefresh>;

/** 悬浮刷新胶囊：放在滚动区的同一 relative 父级内；down 顶部随手指、up 底部、刷新中转圈。
 *  upOffset：up 方式胶囊距滚动区底部的距离（px，默认 20）——
 *  淘宝首页/我的淘宝/频道页底部有 53px TabBar，需传 66 提到 Tab 之上（第六十八轮：
 *  用户反馈「下滑刷新提示被底部 tab 挡住」） */
export function TbPullIndicator({ h, light, upOffset = 20 }: { h: TbPullRefresh; light?: boolean; upOffset?: number }) {
  const cur = h.refreshing ? { dir: h.refreshing, dist: 0 } : h.ghost;
  if (!cur) return null;
  const busy = h.refreshing != null;
  const down = cur.dir === 'down';
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-40 grid place-items-center"
      style={down ? { top: 8 } : { bottom: upOffset }}
    >
      <div
        className={`flex h-9 items-center gap-2 rounded-full px-4 text-[13px] shadow-lg backdrop-blur ${light ? 'bg-white/25 text-white' : 'bg-black/55 text-white'}`}
        style={down && !busy && cur.dist > 0 ? { transform: `translateY(${cur.dist - 34}px)` } : undefined}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : down ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        {busy ? (down ? '正在刷新…' : '正在加载…') : down ? '松开刷新' : '松开加载更多'}
      </div>
    </div>
  );
}
