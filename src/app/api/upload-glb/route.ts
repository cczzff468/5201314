import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile, appendFile, readFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

export const runtime = 'nodejs';

/**
 * POST /api/upload-glb
 * 分片上传大文件（绕过网关请求体大小限制）：
 *   1) chunk 模式：formData: uploadId, seq, chunk(File) —— 保存分片
 *   2) finish 模式：formData: finish=1, uploadId, name, total —— 按序合并分片
 * 兼容旧的单文件模式：formData: file
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    // ---------- finish：合并分片 ----------
    if (formData.get('finish')) {
      const uploadId = String(formData.get('uploadId') || '').replace(/[^\w-]/g, '').slice(0, 64);
      const name = String(formData.get('name') || 'model.glb');
      if (!uploadId) {
        return NextResponse.json({ ok: false, error: 'missing uploadId' }, { status: 400 });
      }
      const dir = path.join(process.cwd(), 'upload-glb', '.parts', uploadId);
      if (!existsSync(dir)) {
        return NextResponse.json({ ok: false, error: '分片不存在，请重新上传' }, { status: 400 });
      }

      const rootDir = path.join(process.cwd(), 'upload-glb');
      await mkdir(rootDir, { recursive: true });
      const safe = name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
      const finalName = `glb-${Date.now()}-${safe}`;
      const finalPath = path.join(rootDir, finalName);

      let seq = 0;
      let merged = 0;
      for (;;) {
        const partPath = path.join(dir, String(seq));
        if (!existsSync(partPath)) break;
        const buf = await readFile(partPath);
        await appendFile(finalPath, buf);
        merged += buf.length;
        seq++;
      }
      await rm(dir, { recursive: true, force: true });
      console.log(
        `[upload-glb] merged ${finalName} (${(merged / 1024 / 1024).toFixed(1)}MB, ${seq} parts)`
      );
      if (seq === 0) {
        return NextResponse.json({ ok: false, error: '没有分片，请重新上传' }, { status: 400 });
      }
      return NextResponse.json({ ok: true, saved: [{ name: finalName, size: merged }] });
    }

    // ---------- chunk：保存一个分片 ----------
    const chunk = formData.get('chunk');
    if (chunk instanceof File) {
      const uploadId = String(formData.get('uploadId') || '').replace(/[^\w-]/g, '').slice(0, 64);
      const seq = Number(formData.get('seq') || 0);
      if (!uploadId) {
        return NextResponse.json({ ok: false, error: 'missing uploadId' }, { status: 400 });
      }
      const dir = path.join(process.cwd(), 'upload-glb', '.parts', uploadId);
      await mkdir(dir, { recursive: true });
      const buf = Buffer.from(await chunk.arrayBuffer());
      await writeFile(path.join(dir, String(seq)), buf);
      return NextResponse.json({ ok: true, seq, size: buf.length });
    }

    // ---------- 兼容：单文件直接上传 ----------
    const entries = formData.getAll('file');
    const files = entries.filter((e): e is File => e instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ ok: false, error: '没有收到文件' }, { status: 400 });
    }

    const dir = path.join(process.cwd(), 'upload-glb');
    await mkdir(dir, { recursive: true });

    const saved: { name: string; size: number }[] = [];
    for (const file of files) {
      const buf = Buffer.from(await file.arrayBuffer());
      const safe = file.name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
      const finalName = `glb-${Date.now()}-${safe}`;
      await writeFile(path.join(dir, finalName), buf);
      saved.push({ name: finalName, size: buf.length });
      console.log(`[upload-glb] saved ${finalName} (${(buf.length / 1024 / 1024).toFixed(1)}MB)`);
    }

    return NextResponse.json({ ok: true, saved });
  } catch (err) {
    console.error('[upload-glb] error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
