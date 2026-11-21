import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { BUILTIN_BOOK_SOURCES } from '@/lib/reading/builtin-sources';
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

/** 首次调用播种内置源（幂等：按 url 去重） */
async function ensureSeeded() {
  const count = await db.bookSource.count({ where: { isBuiltin: true } });
  if (count > 0) return;
  const existUrls = new Set((await db.bookSource.findMany({ select: { url: true } })).map((x) => x.url));
  let order = 0;
  for (const b of BUILTIN_BOOK_SOURCES) {
    const url = b.bookSourceUrl;
    if (existUrls.has(url)) continue;
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

/** 统一导入（single / array / {sources:[...]} 包装均支持） */
async function importArray(
  list: unknown[],
  enabled: boolean,
  markBuiltin = false,
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;
  const existUrls = new Set((await db.bookSource.findMany({ select: { url: true } })).map((x) => x.url));
  let order = await db.bookSource.count();
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
    try {
      await db.bookSource.create({
        data: {
          name: (s.bookSourceName || '').trim().slice(0, 40),
          url,
          group: (s.bookSourceGroup || '导入').toString().slice(0, 30),
          enabled,
          config: JSON.stringify(s),
          isBuiltin: markBuiltin,
          sortOrder: order++,
        },
      });
      imported++;
    } catch {
      skipped++;
    }
  }
  return { imported, skipped, errors: errors.slice(0, 5) };
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
      const res = await proxyFetch(url, { timeoutMs: 30_000 });
      let parsed: unknown;
      try {
        parsed = JSON.parse(res.text) as unknown;
      } catch {
        return NextResponse.json({ error: '该 URL 返回的不是合法 JSON 书源文件' }, { status: 400 });
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
    if (action === 'resetBuiltin') {
      await db.bookSource.deleteMany({ where: { isBuiltin: true } });
      await ensureSeeded();
      return NextResponse.json({ ok: true });
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
