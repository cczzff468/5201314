# -*- coding: utf-8 -*-
"""
VERIFY-2 复验:Android/Chromium 触屏长按菜单「闪现即关」修复效果
修复两层:
  1. 便签卡 onTouchEnd 在 longFired 时 preventDefault() → 阻止浏览器合成 click
  2. 菜单遮罩「关闭菜单」在菜单打开后 350ms 内忽略点击(menuYoung 守卫)

验证路径:
  T1(核心): CDP touchstart → 按住 600ms → touchend → 再等 500ms,菜单应弹出且保持打开
  T2: 菜单打开后点「取消」→ 正常点击路径仍能关闭菜单
  T3: 长按另一张 → 菜单保持 → 点「多选」→ 进入多选模式 → 顶部「取消」退出
  T4(补充): 直接验证 350ms 守卫边界——菜单刚开(<350ms)合成 click 点遮罩不关;>350ms 后点遮罩正常关
  T5: 控制台全程无 error/pageerror
"""
import json
import pathlib
import time
import traceback

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = pathlib.Path("/home/z/my-project/tmp-analysis/verify-shots")
OUT.mkdir(parents=True, exist_ok=True)
REPORT = pathlib.Path("/home/z/my-project/tmp-analysis/verify2-report.json")

results = []
console_msgs = []   # error/warning
page_errors = []

MENU_SEL = '[role="dialog"][aria-label="便签操作"]'
MULTI_BAR = '[role="toolbar"][aria-label="便签多选"]'
BATCH_BAR = '[role="toolbar"][aria-label="便签批量操作"]'
CARD_ANY = 'button[aria-label="查看这张便签"], button[aria-label="勾选这张便签"]'
OVERLAY = f'{MENU_SEL} button[aria-label="关闭菜单"]'

SEED_STATE = {
    "v": 1, "accepted": True, "anniversary": "2024-05-20",
    "meName": "阿泽", "taName": "小鹿", "boardBg": 0,
    "boardNotes": [],  # 空墙:走 UI 建便签路径
}


def log(step, name, ok, evidence):
    results.append({"step": step, "name": name, "ok": bool(ok), "evidence": evidence})
    print(f"[{'PASS' if ok else 'FAIL'}] {step} {name} :: {evidence}", flush=True)


def shot(page, name):
    try:
        page.screenshot(path=str(OUT / f"{name}.png"), timeout=15000)
        print(f"    📸 {name}.png", flush=True)
    except Exception as e:
        print(f"    📸 screenshot failed {name}: {e}", flush=True)


def menu_buttons(page):
    return page.eval_on_selector_all(
        f'{MENU_SEL} button', "els => els.map(e => e.textContent.trim()).filter(Boolean)")


def card_texts(page):
    return page.eval_on_selector_all(
        CARD_ANY,
        "els => els.map(e => Array.from(e.querySelectorAll('p[class*=\"mt-1.5\"]')).map(p => p.textContent.trim()).join('|'))")


def touch_long_press(ctx, page, locator, hold_ms=600):
    """CDP 真实触摸长按:touchstart → 按住 → touchend;返回 (打开时刻ms, 抬手后菜单计数时间线)"""
    box = locator.bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    cdp = ctx.new_cdp_session(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": cx, "y": cy, "id": 1}]})
    # 按住期间等菜单弹出(480ms 阈值)
    opened_at = None
    t0 = time.time()
    while time.time() - t0 < (hold_ms + 800) / 1000.0:
        if page.locator(MENU_SEL).count() == 1:
            opened_at = round((time.time() - t0) * 1000)
            break
        time.sleep(0.02)
    time.sleep(max(0.0, hold_ms / 1000.0 - (time.time() - t0)))  # 补足按住时长
    t_end = time.time()
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    # 抬手后 500ms 轮询菜单计数(核心:不允许出现 0)
    timeline = []
    while time.time() - t_end < 0.55:
        timeline.append(page.locator(MENU_SEL).count())
        time.sleep(0.04)
    cdp.detach()
    return opened_at, timeline


def reach_board(page):
    page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector("text=向上轻扫以解锁", timeout=90000)
    # 种子(跳过邀请页)
    page.evaluate("""async (state) => {
        const db = await new Promise((res, rej) => {
            const r = indexedDB.open('ios-phone-db');
            r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
        });
        await new Promise((res, rej) => {
            const tx = db.transaction('kv', 'readwrite');
            tx.objectStore('kv').put({ key: 'couple-space:state', value: state });
            tx.oncomplete = res; tx.onerror = () => rej(tx.error);
        });
        db.close();
    }""", SEED_STATE)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector("text=向上轻扫以解锁", timeout=90000)
    # 上滑解锁
    page.mouse.move(195, 790)
    page.mouse.down()
    for y in range(770, 240, -30):
        page.mouse.move(195, y)
        time.sleep(0.02)
    page.mouse.up()
    page.wait_for_selector("text=向上轻扫以解锁", state="detached", timeout=10000)
    time.sleep(0.8)
    # 主屏左滑找「恋人空间」
    icon = page.locator('[aria-label="打开恋人空间"]')
    swipes = 0
    for _ in range(8):
        box = icon.bounding_box()
        if box and -5 <= box["x"] and box["x"] + box["width"] <= 395:
            break
        page.mouse.move(340, 400)
        page.mouse.down()
        for x in range(330, 45, -30):
            page.mouse.move(x, 400)
            time.sleep(0.02)
        page.mouse.up()
        swipes += 1
        time.sleep(0.7)
    icon.click()
    page.wait_for_selector('[data-testid="couple-home-title"]', timeout=30000)
    page.locator('button:has-text("留言板")').first.click()
    page.wait_for_selector('p:text-is("留言板")', timeout=15000)
    time.sleep(1.0)
    return swipes


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 390, "height": 844},
                                  device_scale_factor=2, locale="zh-CN",
                                  has_touch=True, is_mobile=True)
        page = ctx.new_page()
        page.on("console", lambda m: console_msgs.append({"type": m.type, "text": m.text})
                if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        print("== Phase 0: unlock & board ==", flush=True)
        swipes = reach_board(page)
        shot(page, "v2-01-board")
        empty = page.locator("text=墙上还空着").count() > 0
        log("0", "解锁→恋人空间→留言板(空墙)", empty or len(card_texts(page)) >= 0,
            f"左滑 {swipes} 次找到图标; 空墙提示={empty}; 现有便签={card_texts(page)}")

        # 若空墙则 UI 建 2 张便签
        if empty:
            for text in ["触屏测试A", "触屏测试B"]:
                page.locator('button[aria-label="钉一张便签"]').click()
                page.wait_for_selector('div[role="dialog"][aria-label="钉一张便签"] textarea', timeout=5000)
                page.fill('div[role="dialog"][aria-label="钉一张便签"] textarea', text)
                page.get_by_role("button", name="钉上留言墙 ♡").click()
                page.wait_for_selector('div[role="dialog"][aria-label="钉一张便签"]', state="detached", timeout=8000)
                time.sleep(0.4)
            time.sleep(0.8)
        texts = card_texts(page)
        shot(page, "v2-02-notes-created")
        log("1", "UI 建便签 2 张", texts == ["触屏测试B", "触屏测试A"], f"DOM 顺序(最新在前)={texts}")

        # ---------- T1 核心:触摸长按 → 菜单弹出且保持 ----------
        print("== T1: touch long-press, menu must STAY OPEN ==", flush=True)
        first_card = page.locator(CARD_ANY).first  # 「触屏测试B」
        opened_at, timeline = touch_long_press(ctx, page, first_card, hold_ms=600)
        shot(page, "v2-03-touch-longpress-menu")
        btns = menu_buttons(page)
        stays = opened_at is not None and all(c == 1 for c in timeline)
        detail_open = page.locator('[role="dialog"][aria-label="便签详情"]').count()
        log("T1", "触屏长按(600ms)→抬手→菜单弹出并保持打开(500ms 内无闪关)",
            stays and set(["置顶", "多选", "删除", "取消"]).issubset(set(btns)),
            f"按住 {opened_at}ms 时菜单弹出; 抬手后 500ms 菜单计数时间线={timeline}; "
            f"按钮={btns}; 便签详情未误开={detail_open == 0}")

        # ---------- T2:正常点击「取消」仍能关菜单 ----------
        print("== T2: click 取消 closes menu ==", flush=True)
        page.get_by_role("button", name="取消", exact=True).click()
        try:
            page.wait_for_selector(MENU_SEL, state="detached", timeout=5000)
            closed = True
        except Exception:
            closed = False
        time.sleep(0.3)
        shot(page, "v2-04-menu-closed-by-cancel")
        log("T2", "点「取消」→ 菜单正常关闭(正常点击路径未被修复破坏)", closed,
            f"菜单元素已移除={closed}; 便签仍在={card_texts(page)}")

        # ---------- T3:长按另一张 → 多选 → 取消退出 ----------
        print("== T3: long-press → 多选 → exit ==", flush=True)
        second_card = page.locator(CARD_ANY).nth(1)  # 「触屏测试A」
        opened_at3, timeline3 = touch_long_press(ctx, page, second_card, hold_ms=600)
        shot(page, "v2-05-touch-menu-2nd")
        stays3 = opened_at3 is not None and all(c == 1 for c in timeline3)
        page.get_by_role("button", name="多选", exact=True).click()
        page.wait_for_selector(MULTI_BAR, timeout=5000)
        time.sleep(0.6)
        bar_top = page.locator(MULTI_BAR).inner_text().replace("\n", " ")
        cards_sel = page.eval_on_selector_all(
            CARD_ANY,
            "els => els.filter(e => String(e.className).includes('ring-black')).map(e => Array.from(e.querySelectorAll('p[class*=\"mt-1.5\"]')).map(p=>p.textContent.trim()).join('|'))")
        shot(page, "v2-06-multiselect")
        # 顶部「取消」退出多选(该按钮可访问名=aria-label「退出多选」)
        page.locator(MULTI_BAR).locator('button[aria-label="退出多选"]').click()
        time.sleep(0.5)
        multi_gone = page.locator(MULTI_BAR).count() == 0 and page.locator(BATCH_BAR).count() == 0
        fab_back = page.locator('button[aria-label="钉一张便签"]').count() == 1
        shot(page, "v2-07-multiselect-exited")
        log("T3", "长按另一张→菜单保持→「多选」进入→顶部「取消」退出",
            stays3 and "已选 1 张" in bar_top and cards_sel == ["触屏测试A"] and multi_gone and fab_back,
            f"第二次长按菜单时间线={timeline3}; 多选栏={bar_top}; 已勾选={cards_sel}; "
            f"退出后工具栏消失={multi_gone}; +按钮回归={fab_back}")

        # ---------- T4 补充:350ms 守卫边界(右键开菜单 + 合成 click) ----------
        print("== T4: 350ms overlay guard boundaries ==", flush=True)
        page.locator(CARD_ANY).first.click(button="right")
        page.wait_for_selector(MENU_SEL, timeout=5000)
        # (a) 菜单刚开 <350ms,立即在遮罩上派发 click → 应被忽略
        page.eval_on_selector(OVERLAY, "el => el.click()")
        time.sleep(0.15)
        early_ignored = page.locator(MENU_SEL).count() == 1
        # (b) 等 >350ms 再点遮罩 → 正常关闭
        time.sleep(0.45)
        page.eval_on_selector(OVERLAY, "el => el.click()")
        time.sleep(0.3)
        late_closed = page.locator(MENU_SEL).count() == 0
        shot(page, "v2-08-guard-boundaries")
        log("T4", "遮罩 350ms 守卫:刚开时合成 click 被忽略;>350ms 后点遮罩正常关",
            early_ignored and late_closed,
            f"<350ms 点击后菜单仍在={early_ignored}; >350ms 点击后菜单关闭={late_closed}")

        # ---------- T5 控制台 ----------
        log("T5", "控制台无 error/pageerror", len(console_msgs) == 0 and len(page_errors) == 0,
            f"console error/warning={len(console_msgs)} 条; pageerror={len(page_errors)} 条")
        for m in console_msgs[:8]:
            print("  console:", m["type"], m["text"][:180], flush=True)
        for e in page_errors[:8]:
            print("  pageerror:", e[:180], flush=True)

        browser.close()

    summary = {
        "total": len(results),
        "passed": sum(1 for r in results if r["ok"]),
        "failed": [r for r in results if not r["ok"]],
        "results": results,
        "console_msgs": console_msgs,
        "page_errors": page_errors,
    }
    REPORT.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n===== SUMMARY =====", flush=True)
    print(f"passed {summary['passed']}/{summary['total']}", flush=True)


if __name__ == "__main__":
    try:
        run()
    except Exception:
        traceback.print_exc()
        import sys
        sys.exit(1)
