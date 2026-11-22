import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { BUILTIN_BOOK_SOURCES, VERIFIED_SOURCES, normSourceUrl } from '@/lib/reading/builtin-sources';
import { checkSource, proxyFetch, type LegadoSource } from '@/lib/reading/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 合法书源校验：必须有名字 + 可用 URL + searchUrl */
function validateSource(raw: unknown): { ok: true; source: LegadoSource } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: '不是有效的 JSON 对象' };
  const s = raw as Record<string, unknown>;
  const name = typeof s.bookSourceName === 'string' ? s.bookSourceName.trim() : '';
  const url = typeof s.bookSourceUrl === 'string' ? s.bookSourceUrl.trim() : '';
  if (!name) return { ok: false, error: '缺少 bookSourceName（书源名称）' };
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: '缺少或非法 bookSourceUrl（需 http(s):// 开头）' };
  if (typeof s.searchUrl !== 'string' || !s.searchUrl.trim())
    return { ok: false, error: '缺少 searchUrl（搜索地址）' };
  return { ok: true, source: raw as LegadoSource };
}

/** 播种内置源（幂等；2026-11-21 重构：
 *  ① 新内置源补种入库；
 *  ② 库里已存在的同 URL 源（如用户曾手动导入过 396 合集）——保留原 ID（不破坏书架/历史引用），
 *     仅标记 isBuiltin=true，启停状态尊重用户自己的操作（如筛活停用的失效源不强行拉起）；
 *  ③ 已除名的旧内置源（实测没用的）自动从库里删除，书架/历史引用按 healSourceRefs 自愈 */
async function ensureSeeded() {
  const rows = await db.bookSource.findMany({ select: { id: true, url: true, isBuiltin: true, sortOrder: true } });
  const byUrl = new Map(rows.map((x) => [normSourceUrl(x.url), x]));
  const builtinUrls = new Set(BUILTIN_BOOK_SOURCES.map((b) => normSourceUrl(b.bookSourceUrl)));
  /** 实测核心源（VERIFIED）固定占据 sortOrder 0..N-1：聚合搜索时最先出结果 */
  const verifiedUrls = new Map(VERIFIED_SOURCES.map((v, i) => [normSourceUrl(v.bookSourceUrl), i] as const));
  const N_VERIFIED = VERIFIED_SOURCES.length;
  let changed = false;
  let order = rows.length + N_VERIFIED;
  for (const b of BUILTIN_BOOK_SOURCES) {
    const vIdx = verifiedUrls.get(normSourceUrl(b.bookSourceUrl));
    const targetOrder = vIdx !== undefined ? vIdx : order++;
    const exist = byUrl.get(normSourceUrl(b.bookSourceUrl));
    if (exist) {
      // 核心源 sortOrder 被挤到后面（如晚入库）→ 拉回前排，搜索优先命中
      const needFix = vIdx !== undefined && (exist.sortOrder === null || exist.sortOrder >= N_VERIFIED);
      if (!exist.isBuiltin || needFix) {
        await db.bookSource
          .update({
            where: { id: exist.id },
            data: { isBuiltin: true, ...(needFix ? { sortOrder: targetOrder } : {}) },
          })
          .catch(() => null);
        changed = true;
      }
      continue;
    }
    await db.bookSource
      .create({
        data: {
          name: (b.bookSourceName || '未命名').slice(0, 40),
          url: b.bookSourceUrl,
          group: (b.bookSourceGroup || '小说').toString().slice(0, 30),
          enabled: b.enabled !== false,
          config: JSON.stringify(b),
          isBuiltin: true,
          sortOrder: targetOrder,
          checkStatus: b.enabled !== false && VERIFIED_SOURCES.some((v) => normSourceUrl(v.bookSourceUrl) === normSourceUrl(b.bookSourceUrl)) ? 'ok' : null,
        },
      })
      .catch(() => null);
    changed = true;
  }
  // 清理已除名旧内置源（保留 ID 的合集源不在此列——它们的 URL 都在新清单里）
  const stale = rows.filter((r) => r.isBuiltin && !builtinUrls.has(normSourceUrl(r.url)));
  for (const s of stale) {
    await db.bookSource.delete({ where: { id: s.id } }).catch(() => null);
    changed = true;
  }
  if (changed) await healSourceRefs().catch(() => null);
}

export function toLegado(row: { name: string; url: string; config: string }): LegadoSource {
  let cfg: Partial<LegadoSource> = {};
  try {
    cfg = JSON.parse(row.config) as Partial<LegadoSource>;
  } catch {
    /* 空配置兜底 */
  }
  return { bookSourceName: row.name, bookSourceUrl: row.url, ...cfg } as LegadoSource;
}

/** GET：书源列表（?enabled=1 仅启用） */
export async function GET(req: NextRequest) {
  await ensureSeeded();
  const sp = req.nextUrl.searchParams;
  const where = sp.get('enabled') === '1' ? { enabled: true } : {};
  const rows = await db.bookSource.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  return NextResponse.json({
    sources: rows.map((r) => ({
      id: r.id,
      name: r.name,
      url: r.url,
      group: r.group,
      enabled: r.enabled,
      isBuiltin: r.isBuiltin,
      checkStatus: r.checkStatus,
      lastCheckAt: r.lastCheckAt,
    })),
  });
}

/** 统一导入（single / array / {sources:[...]} 包装均支持；批量插入提速，几千源秒级完成）
 *  超大合集（>100 源）默认停用导入——避免几百个死源拖慢搜索，导入后用「一键筛活」自动启用可用源 */
async function importArray(
  list: unknown[],
  enabled: boolean,
  markBuiltin = false,
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;
  // 超大合集（>100 源）强制默认停用：几百个死源会拖慢聚合搜索
  const effectiveEnabled = list.length > 100 ? false : enabled;
  const existUrls = new Set((await db.bookSource.findMany({ select: { url: true } })).map((x) => x.url));
  let order = await db.bookSource.count();
  const rows: {
    name: string;
    url: string;
    group: string;
    enabled: boolean;
    config: string;
    isBuiltin: boolean;
    sortOrder: number;
  }[] = [];
  for (const raw of list) {
    const v = validateSource(raw);
    if (!v.ok) {
      errors.push(v.error);
      skipped++;
      continue;
    }
    const s = v.source;
    const url = s.bookSourceUrl.trim().replace(/\/+$/, '/');
    if (existUrls.has(url)) {
      skipped++;
      continue;
    }
    existUrls.add(url);
    rows.push({
      name: (s.bookSourceName || '').trim().slice(0, 40),
      url,
      group: (s.bookSourceGroup || '导入').toString().slice(0, 30),
      enabled: effectiveEnabled,
      config: JSON.stringify(s),
      isBuiltin: markBuiltin,
      sortOrder: order++,
    });
  }
  // 分批 createMany（SQLite 单语句变量上限，按 200/批安全；URL 已在上层去重）
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const r = await db.bookSource.createMany({ data: batch });
    imported += r.count;
  }
  return { imported, skipped, errors: errors.slice(0, 5) };
}

/**
 * 自愈失效的书源引用：书架/历史里 sourceId 已不存在的记录，
 * ① 按记录里留存的 sourceName 精确同名匹配（书源重建场景，最常见）
 * ② 按 bookUrl 站点前缀匹配（镜像域名不同也能靠名字兜住）
 */
async function healSourceRefs() {
  const sources = await db.bookSource.findMany({ select: { id: true, url: true, name: true } });
  const idSet = new Set(sources.map((s) => s.id));
  const byName = new Map(sources.map((s) => [s.name, s.id]));
  const prefixList = sources
    .map((s) => ({ id: s.id, url: s.url.replace(/\/+$/, '/') }))
    .filter((s) => s.url.length > 12)
    .sort((a, b) => b.url.length - a.url.length);

  const resolve = (sourceName: string | null, bookUrl: string): string | null => {
    if (sourceName && byName.has(sourceName)) return byName.get(sourceName) as string;
    return prefixList.find((s) => bookUrl.startsWith(s.url))?.id || null;
  };

  const healRows = async (
    rows: { id: string; sourceId: string; sourceName: string | null; bookUrl: string }[],
    table: 'shelf' | 'history',
  ) => {
    for (const r of rows) {
      if (idSet.has(r.sourceId)) continue; // 引用仍有效
      const hit = resolve(r.sourceName, r.bookUrl);
      if (hit) {
        const data = { sourceId: hit };
        if (table === 'shelf') {
          await db.shelfBook.update({ where: { id: r.id }, data }).catch(() => null);
        } else {
          await db.readHistory.update({ where: { id: r.id }, data }).catch(() => null);
        }
      }
    }
  };
  const shelfRows = await db.shelfBook.findMany({ select: { id: true, sourceId: true, sourceName: true, bookUrl: true } });
  await healRows(shelfRows, 'shelf');
  const histRows = await db.readHistory.findMany({ select: { id: true, sourceId: true, sourceName: true, bookUrl: true } });
  await healRows(histRows, 'history');
}

/**
 * POST 动作：
 * - { action:'importJson', json, enabled? }   粘贴 JSON 导入（自定义/上传文件解析后走这里）
 * - { action:'importUrl', url, enabled? }     从书源合集 URL 导入（如 aoaostar 直链）
 * - { action:'create', source }               新增单个自定义源
 * - { action:'toggle', id, enabled }          启停
 * - { action:'delete', id }                   删除
 * - { action:'check', id }                    健康检查（真实搜索一次）
 * - { action:'checkAll' }                     批量检查（并发）
 * - { action:'resetBuiltin' }                 恢复全部内置源
 * - { action:'sort', ids }                    排序
 */
export async function POST(req: NextRequest) {
  await ensureSeeded();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || '');
  try {
    if (action === 'importJson') {
      let list: unknown[] = [];
      const raw = body.json;
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return NextResponse.json({ error: '内容为空' }, { status: 400 });
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) list = parsed;
        else if (parsed && typeof parsed === 'object') {
          const o = parsed as Record<string, unknown>;
          if (Array.isArray(o.sources)) list = o.sources as unknown[];
          else list = [parsed];
        }
      } else if (Array.isArray(raw)) list = raw;
      else if (raw && typeof raw === 'object') list = [raw];
      else return NextResponse.json({ error: 'json 字段格式不对' }, { status: 400 });
      return NextResponse.json(await importArray(list, body.enabled !== false));
    }
    if (action === 'importUrl') {
      const url = String(body.url || '').trim();
      if (!/^https?:\/\//i.test(url)) return NextResponse.json({ error: 'URL 非法' }, { status: 400 });
      const res = await proxyFetch(url, { timeoutMs: 90_000 });
      let parsed: unknown;
      try {
        parsed = JSON.parse(res.text) as unknown;
      } catch {
        return NextResponse.json({ error: '该 URL 返回的不是合法 JSON 书源文件' }, { status: 400 });
      }
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return NextResponse.json(await importArray(list, body.enabled !== false));
    }
    if (action === 'importLocal') {
      // 预置书源合集（public/reading-sources/*.json，随代码分发，秒导入不受外网波动影响）
      const ALLOWED = new Set(['xiu2.json', 'pobing.json', 'yiove.json']);
      const file = String(body.file || '');
      if (!ALLOWED.has(file)) return NextResponse.json({ error: '未知预置书源' }, { status: 400 });
      const path = join(process.cwd(), 'public', 'reading-sources', file);
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
      } catch {
        return NextResponse.json({ error: '预置书源文件读取失败' }, { status: 500 });
      }
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return NextResponse.json(await importArray(list, body.enabled !== false));
    }
    if (action === 'create') {
      const v = validateSource(body.source);
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
      const s = v.source;
      const url = s.bookSourceUrl.trim().replace(/\/+$/, '/');
      const dup = await db.bookSource.findFirst({ where: { url } });
      if (dup) return NextResponse.json({ error: '已存在相同地址的书源' }, { status: 400 });
      const row = await db.bookSource.create({
        data: {
          name: s.bookSourceName.trim().slice(0, 40),
          url,
          group: (s.bookSourceGroup || '自定义').toString().slice(0, 30),
          enabled: body.enabled !== false,
          config: JSON.stringify(s),
          isBuiltin: false,
          sortOrder: await db.bookSource.count(),
        },
      });
      return NextResponse.json({ id: row.id });
    }
    if (action === 'toggle') {
      await db.bookSource.update({
        where: { id: String(body.id || '') },
        data: { enabled: Boolean(body.enabled) },
      });
      return NextResponse.json({ ok: true });
    }
    if (action === 'delete') {
      await db.bookSource.delete({ where: { id: String(body.id || '') } });
      return NextResponse.json({ ok: true });
    }
    if (action === 'check') {
      const id = String(body.id || '');
      const row = await db.bookSource.findUnique({ where: { id } });
      if (!row) return NextResponse.json({ error: '书源不存在' }, { status: 404 });
      const ok = await checkSource(toLegado(row));
      await db.bookSource.update({
        where: { id },
        data: { checkStatus: ok ? 'ok' : 'fail', lastCheckAt: new Date() },
      });
      return NextResponse.json({ ok });
    }
    if (action === 'checkAll') {
      const rows = await db.bookSource.findMany({ where: { enabled: true } });
      const results: { id: string; name: string; ok: boolean }[] = [];
      const queue = [...rows];
      const worker = async () => {
        while (queue.length) {
          const row = queue.shift()!;
          const ok = await checkSource(toLegado(row));
          await db.bookSource.update({
            where: { id: row.id },
            data: { checkStatus: ok ? 'ok' : 'fail', lastCheckAt: new Date() },
          });
          results.push({ id: row.id, name: row.name, ok });
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
      return NextResponse.json({ results });
    }
    if (action === 'checkBatch') {
      // 分批实测（客户端逐批调，避免长请求超时）：autoDisable=true 时失败的源自动停用
      const ids = Array.isArray(body.ids) ? (body.ids as string[]).map(String) : [];
      const autoDisable = body.autoDisable !== false;
      const rows = await db.bookSource.findMany({ where: { id: { in: ids } } });
      const results: { id: string; name: string; ok: boolean }[] = [];
      const queue = [...rows];
      const worker = async () => {
        while (queue.length) {
          const row = queue.shift()!;
          const ok = await checkSource(toLegado(row));
          await db.bookSource
            .update({
              where: { id: row.id },
              data: {
                checkStatus: ok ? 'ok' : 'fail',
                lastCheckAt: new Date(),
                ...(ok ? { enabled: true } : autoDisable ? { enabled: false } : {}),
              },
            })
            .catch(() => null);
          results.push({ id: row.id, name: row.name, ok });
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      return NextResponse.json({ results });
    }
    if (action === 'sortUsable') {
      // 可用源排前（搜索优先命中）；返回统计
      const all = await db.bookSource.findMany();
      const ok = all.filter((s) => s.checkStatus === 'ok');
      const rest = all.filter((s) => s.checkStatus !== 'ok');
      let i = 0;
      for (const s of ok) {
        await db.bookSource.update({ where: { id: s.id }, data: { sortOrder: i++ } }).catch(() => null);
      }
      for (const s of rest) {
        await db.bookSource.update({ where: { id: s.id }, data: { sortOrder: i++ } }).catch(() => null);
      }
      return NextResponse.json({ ok: true, okCount: ok.length, total: all.length });
    }
    if (action === 'deleteFailed') {
      // 一键清理：删除全部实测失败且已停用的源（内置源不删）
      const del = await db.bookSource.deleteMany({
        where: { checkStatus: 'fail', enabled: false, isBuiltin: false },
      });
      return NextResponse.json({ ok: true, deleted: del.count });
    }
    if (action === 'resetBuiltin') {
      // 按URL upsert（保留已有行ID，不破坏书架/历史里的 sourceId 引用）：
      // 已存在 → 更新配置并重新启用；不存在 → 新建
      const all = await db.bookSource.findMany({ select: { id: true, url: true } });
      const byUrl = new Map(all.map((x) => [x.url, x.id]));
      let restored = 0;
      let order = all.length;
      for (const b of BUILTIN_BOOK_SOURCES) {
      const url = b.bookSourceUrl;
        const existId = byUrl.get(url);
        if (existId) {
          await db.bookSource.update({
            where: { id: existId },
            data: {
              name: b.bookSourceName,
              config: JSON.stringify(b),
              enabled: true,
              isBuiltin: true,
              checkStatus: b.enabled !== false ? 'ok' : null,
            },
          });
        } else {
          await db.bookSource.create({
            data: {
              name: b.bookSourceName,
              url,
              group: b.bookSourceGroup || '小说',
              enabled: b.enabled !== false,
              config: JSON.stringify(b),
              isBuiltin: true,
              sortOrder: order++,
              checkStatus: b.enabled !== false ? 'ok' : null,
            },
          });
        }
        restored++;
      }
      // 自愈：书架/历史里引用已失效书源的记录，按 bookUrl 前缀匹配回新源
      await healSourceRefs().catch(() => null);
      return NextResponse.json({ ok: true, restored });
    }
    if (action === 'sort') {
      const ids = Array.isArray(body.ids) ? (body.ids as string[]) : [];
      let i = 0;
      for (const id of ids) {
        await db.bookSource.update({ where: { id }, data: { sortOrder: i++ } }).catch(() => null);
      }
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '操作失败' }, { status: 500 });
  }
}
