import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 排版设置默认值（与 Prisma 默认一致，客户端首屏兜底也用同一份结构） */
export const DEFAULT_READING_SETTINGS = {
  fontSize: 19,
  fontFamily: 'system',
  fontWeight: 'normal',
  bgTheme: 'paper',
  bgCustom: null as string | null,
  fontCustom: null as string | null,
  appTheme: 'ocean',
  letterSpacing: 0,
  lineSpacing: 1.9,
  paraSpacing: 0.9,
  marginLeft: 5,
  marginRight: 5,
  marginTop: 4,
  marginBottom: 4,
  titlePosition: 'left',
  justify: true,
  bottomAlign: false,
  underline: false,
  profileName: null as string | null,
  profileId: null as string | null,
  profileAvatar: null as string | null,
  customGroups: [] as string[],
};

type Settings = typeof DEFAULT_READING_SETTINGS;
type SettingsPatch = Omit<Partial<Settings>, 'customGroups'> & { customGroups?: string[] | string };

function coerce(raw: Partial<Record<keyof SettingsPatch, unknown>>): Partial<Settings> {
  const out: Partial<Settings> = {};
  const num = (v: unknown, lo: number, hi: number) => {
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    if (Number.isFinite(n)) return Math.min(hi, Math.max(lo, n));
    return undefined;
  };
  const n1 = num(raw.fontSize, 12, 32);
  if (n1 !== undefined) out.fontSize = Math.round(n1);
  const n2 = num(raw.letterSpacing, -1, 6);
  if (n2 !== undefined) out.letterSpacing = n2;
  const n3 = num(raw.lineSpacing, 1.1, 3);
  if (n3 !== undefined) out.lineSpacing = n3;
  const n4 = num(raw.paraSpacing, 0, 3);
  if (n4 !== undefined) out.paraSpacing = n4;
  for (const k of ['marginLeft', 'marginRight'] as const) {
    const n = num(raw[k], 0, 24);
    if (n !== undefined) out[k] = n;
  }
  for (const k of ['marginTop', 'marginBottom'] as const) {
    const n = num(raw[k], 0, 24);
    if (n !== undefined) out[k] = n;
  }
  if (typeof raw.fontFamily === 'string') out.fontFamily = raw.fontFamily.slice(0, 30);
  if (typeof raw.fontWeight === 'string' && ['normal', 'bold', 'light'].includes(raw.fontWeight))
    out.fontWeight = raw.fontWeight;
  if (typeof raw.bgTheme === 'string') out.bgTheme = raw.bgTheme.slice(0, 30);
  if (typeof raw.appTheme === 'string') out.appTheme = raw.appTheme.slice(0, 30);
  if (typeof raw.titlePosition === 'string' && ['left', 'center', 'hidden'].includes(raw.titlePosition))
    out.titlePosition = raw.titlePosition;
  if (typeof raw.justify === 'boolean') out.justify = raw.justify;
  if (typeof raw.bottomAlign === 'boolean') out.bottomAlign = raw.bottomAlign;
  if (typeof raw.underline === 'boolean') out.underline = raw.underline;
  // 我的资料：昵称 / 自定义 ID / 头像（dataURL，限制 1.5MB）
  for (const k of ['profileName', 'profileId'] as const) {
    const v = raw[k];
    if (typeof v === 'string') out[k] = v.trim().slice(0, 24) || null;
    if (v === null) out[k] = null;
  }
  {
    const v = raw.profileAvatar;
    if (typeof v === 'string') out.profileAvatar = v.startsWith('data:') && v.length < 1_500_000 ? v : null;
    if (v === null) out.profileAvatar = null;
  }
  // 书架自定义分组名列表（限制 30 个、单个长度 ≤20）
  if (raw.customGroups !== undefined) {
    let groups: string[] = [];
    if (typeof raw.customGroups === 'string') {
      try {
        groups = JSON.parse(raw.customGroups) as string[];
      } catch {
        groups = [];
      }
    } else if (Array.isArray(raw.customGroups)) {
      groups = raw.customGroups.map(String);
    }
    out.customGroups = [...new Set(groups.map((g) => g.trim().slice(0, 20)).filter(Boolean))].slice(0, 30);
  }
  // 自定义背景/字体为 dataURL（限制 3MB，防止超大文件入库）
  for (const k of ['bgCustom', 'fontCustom'] as const) {
    const v = raw[k];
    if (typeof v === 'string') out[k] = v.startsWith('data:') && v.length < 3_000_000 ? v : null;
    if (v === null) out[k] = null;
  }
  return out;
}

/** GET 单例设置（无记录返回默认值） */
export async function GET() {
  const row = await db.readingSetting.findUnique({ where: { id: 'singleton' } });
  if (!row) return NextResponse.json({ settings: DEFAULT_READING_SETTINGS });
  let groups: string[] = [];
  try {
    groups = JSON.parse(row.customGroups || '[]') as string[];
  } catch {
    groups = [];
  }
  return NextResponse.json({
    settings: {
      ...DEFAULT_READING_SETTINGS,
      fontSize: row.fontSize,
      fontFamily: row.fontFamily,
      fontWeight: row.fontWeight,
      bgTheme: row.bgTheme,
      bgCustom: row.bgCustom,
      fontCustom: row.fontCustom,
      appTheme: row.appTheme,
      letterSpacing: row.letterSpacing,
      lineSpacing: row.lineSpacing,
      paraSpacing: row.paraSpacing,
      marginLeft: row.marginLeft,
      marginRight: row.marginRight,
      marginTop: row.marginTop,
      marginBottom: row.marginBottom,
      titlePosition: row.titlePosition,
      justify: row.justify,
      bottomAlign: row.bottomAlign,
      underline: row.underline,
      profileName: row.profileName,
      profileId: row.profileId,
      profileAvatar: row.profileAvatar,
      customGroups: groups,
    } satisfies Settings,
  });
}

/** PUT 局部更新（滑块实时预览 → 前端本地即时应用，这里 300ms 防抖后落库） */
export async function PUT(req: NextRequest) {
  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch = coerce(raw as Partial<Record<keyof SettingsPatch, unknown>>);
  // customGroups 单独序列化（Prisma 存 JSON 字符串）
  const { customGroups, ...rest } = patch;
  const data: Record<string, unknown> = { ...rest };
  if (customGroups !== undefined) data.customGroups = JSON.stringify(customGroups);
  await db.readingSetting.upsert({
    where: { id: 'singleton' },
    update: { ...data },
    create: { id: 'singleton', ...data },
  });
  return NextResponse.json({ ok: true });
}
