# -*- coding: utf-8 -*-
"""
VERIFY-1: 浏览器端到端验证 —— iOS 手机模拟器 / 情侣空间(恋人空间) / 恋爱留言板 便签长按操作菜单
验证点 A-F:长按菜单弹出、置顶、取消置顶、多选模式、批量删除、单张删除二次确认
触发方式:便签卡片上右键(contextmenu)→ 代码 onContextMenu → onLongPress
"""
import json
import pathlib
import sys
import time
import traceback

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = pathlib.Path("/home/z/my-project/tmp-analysis/verify-shots")
OUT.mkdir(parents=True, exist_ok=True)
REPORT = pathlib.Path("/home/z/my-project/tmp-analysis/verify-report.json")

results = []          # [{step, name, ok, evidence}]
console_errors = []   # [{type, text}]
page_errors = []      # [str]
failed_requests = []  # [{url, failure}]
board_bg_requests = []

CARD_SEL = 'button[aria-label="查看这张便签"]'
# 多选模式下卡片 aria-label 会变成「勾选这张便签」—— 两种都要能选中
CARD_ANY = 'button[aria-label="查看这张便签"], button[aria-label="勾选这张便签"]'
MENU_SEL = '[role="dialog"][aria-label="便签操作"]'


def log(step, name, ok, evidence):
    results.append({"step": step, "name": name, "ok": bool(ok), "evidence": evidence})
    print(f"[{'PASS' if ok else 'FAIL'}] {step} {name} :: {evidence}", flush=True)


def shot(page, name):
    path = OUT / f"{name}.png"
    try:
        page.screenshot(path=str(path), timeout=15000)
        print(f"    📸 {path}", flush=True)
    except Exception as e:
        print(f"    📸 screenshot failed {name}: {e}", flush=True)
    return str(path)


def note_cards(page):
    """墙上便签卡片的 DOM 摘要(顺序 = 瀑布流 DOM 顺序)"""
    return page.eval_on_selector_all(
        CARD_ANY,
        """els => els.map((e, i) => {
            const txt = Array.from(e.querySelectorAll('p[class*="mt-1.5"]')).map(p => p.textContent.trim()).join('|');
            const pinned = Array.from(e.querySelectorAll('span')).some(s => s.textContent.trim() === '置顶');
            const date = (e.querySelector('p[class*="mt-2"]')?.textContent || '').trim();
            const selected = String(e.className).includes('ring-black');
            const badge = e.querySelector('span.absolute.right-2.top-2');
            return { i, text: txt, pinned, selected, hasCheckBadge: !!badge, date, clsTail: String(e.className).slice(-70) };
        })""",
    )


def menu_buttons(page):
    return page.eval_on_selector_all(
        f'{MENU_SEL} button', "els => els.map(e => e.textContent.trim()).filter(Boolean)")


def menu_preview(page):
    return page.eval_on_selector_all(
        f'{MENU_SEL} p.line-clamp-2', "els => els.map(e => e.textContent.trim())")


def wait_stable(ms=700):
    time.sleep(ms / 1000.0)


SEED_STATE = {
    "v": 1,
    "accepted": True,
    "anniversary": "2024-05-20",
    "meName": "阿泽",
    "taName": "小鹿",
    "boardNotes": [],
    "boardBg": 0,
}


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            locale="zh-CN",
        )
        page = ctx.new_page()

        page.on("console", lambda m: console_errors.append({"type": m.type, "text": m.text})
                if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.on("requestfailed", lambda r: failed_requests.append(
            {"url": r.url, "failure": str(r.failure)}))
        page.on("response", lambda r: board_bg_requests.append(
            {"url": r.url, "status": r.status}) if "board-bg" in r.url else None)

        # ---------- 0. 启动 + 锁屏 ----------
        print("== Phase 0: boot & lockscreen ==", flush=True)
        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector("text=向上轻扫以解锁", timeout=90000)
        shot(page, "01-lockscreen")
        log("0", "开机进入锁屏(无白屏)", True, "锁屏出现「向上轻扫以解锁」")

        # ---------- 1. 种子数据:情侣空间已接受邀请(留言板空墙) ----------
        seeded = page.evaluate(
            """async (state) => {
                const db = await new Promise((res, rej) => {
                    const r = indexedDB.open('ios-phone-db');
                    r.onsuccess = () => res(r.result);
                    r.onerror = () => rej(r.error);
                });
                await new Promise((res, rej) => {
                    const tx = db.transaction('kv', 'readwrite');
                    tx.objectStore('kv').put({ key: 'couple-space:state', value: state });
                    tx.oncomplete = res;
                    tx.onerror = () => rej(tx.error);
                    tx.onabort = () => rej(tx.error);
                });
                const got = await new Promise((res, rej) => {
                    const tx = db.transaction('kv', 'readonly');
                    const rq = tx.objectStore('kv').get('couple-space:state');
                    rq.onsuccess = () => res(rq.result);
                    rq.onerror = () => rej(rq.error);
                });
                db.close();
                return !!(got && got.value && got.value.accepted === true);
            }""",
            SEED_STATE,
        )
        log("1", "种子 IndexedDB couple-space:state(accepted)", seeded, f"写回校验 accepted={seeded}")
        if not seeded:
            return

        # ---------- 2. 刷新后真实解锁手势(上滑) ----------
        print("== Phase 1: reload + swipe-up unlock ==", flush=True)
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("text=向上轻扫以解锁", timeout=90000)
        page.mouse.move(195, 790)
        page.mouse.down()
        for y in range(770, 240, -30):
            page.mouse.move(195, y)
            time.sleep(0.02)
        page.mouse.up()
        try:
            page.wait_for_selector("text=向上轻扫以解锁", state="detached", timeout=10000)
            unlocked = True
        except Exception:
            unlocked = False
        wait_stable(800)
        shot(page, "02-home-after-unlock")
        log("2", "上滑解锁进入主屏幕", unlocked, "锁屏退场,主屏出现")

        # ---------- 3. 主屏翻页找「恋人空间」图标并打开 ----------
        print("== Phase 2: find couple app icon ==", flush=True)
        icon = page.locator('[aria-label="打开恋人空间"]')
        found_page = None
        for attempt in range(8):
            box = icon.bounding_box()
            if box and -5 <= box["x"] and box["x"] + box["width"] <= 395:
                found_page = attempt
                break
            page.mouse.move(340, 400)
            page.mouse.down()
            for x in range(330, 45, -30):
                page.mouse.move(x, 400)
                time.sleep(0.02)
            page.mouse.up()
            wait_stable(700)
        if found_page is None:
            shot(page, "03-icon-not-found")
            log("3", "主屏找到恋人空间图标", False, "翻页 8 次未见图标")
            return
        shot(page, "03-home-couple-icon")
        log("3", "主屏翻页找到「恋人空间」图标", True,
            f"第 {found_page} 次左滑后图标进入视口")
        icon.click()
        try:
            page.wait_for_selector('[data-testid="couple-home-title"]', timeout=30000)
            in_home = True
        except Exception:
            in_home = False
        invite_visible = page.locator("text=邀请你开通恋人空间").count() > 0
        shot(page, "04-couple-home")
        log("4", "打开恋人空间 → 首页(非邀请页)", in_home and not invite_visible,
            f"标题「恋人空间」出现={in_home}; 邀请页残留={invite_visible}")

        # ---------- 4. 进入恋爱留言板 ----------
        print("== Phase 3: open board ==", flush=True)
        board_card = page.locator('button:has-text("留言板")').first
        board_card.click()
        page.wait_for_selector('p:text-is("留言板")', timeout=15000)
        wait_stable(900)
        shot(page, "05-board-empty")
        empty_hint = page.locator("text=墙上还空着").count() > 0
        cards = note_cards(page)
        log("5", "点击「恋爱留言板」卡片进入留言板", True,
            f"留言板标题出现; 空墙提示={empty_hint}; 便签数={len(cards)}")

        # 背景渲染检查
        bg_style = page.evaluate(
            """() => {
                const els = Array.from(document.querySelectorAll('div'));
                const el = els.find(e => (e.style.backgroundImage || '').includes('board-bg'));
                return el ? { bg: el.style.backgroundImage.slice(0, 120), w: el.clientWidth, h: el.clientHeight } : null;
            }""")
        log("5b", "留言板背景图渲染", bool(bg_style), f"容器背景 style={bg_style}")

        # ---------- 5. 创建 3 张便签 ----------
        print("== Phase 4: create 3 notes ==", flush=True)
        created = []
        for text in ["测试便签一", "测试便签二", "测试便签三"]:
            page.locator('button[aria-label="钉一张便签"]').click()
            page.wait_for_selector('div[role="dialog"][aria-label="钉一张便签"] textarea', timeout=5000)
            page.fill('div[role="dialog"][aria-label="钉一张便签"] textarea', text)
            page.get_by_role("button", name="钉上留言墙 ♡").click()
            page.wait_for_selector('div[role="dialog"][aria-label="钉一张便签"]', state="detached", timeout=8000)
            wait_stable(500)
            created.append(text)
        wait_stable(900)
        shot(page, "06-board-3notes")
        cards = note_cards(page)
        texts = [c["text"] for c in cards]
        log("6", "+ 按钮书写区创建 3 张便签", texts == ["测试便签三", "测试便签二", "测试便签一"],
            f"DOM 顺序(最新在前)={texts}")

        # ---------- TEST A:右键便签 → 长按菜单 ----------
        print("== TEST A: contextmenu → action sheet ==", flush=True)
        page.locator(CARD_ANY).nth(1).click(button="right")  # 右键「测试便签二」
        page.wait_for_selector(MENU_SEL, timeout=5000)
        wait_stable(600)
        shot(page, "07-longpress-menu")
        btns = menu_buttons(page)
        prev = menu_preview(page)
        expect_btns = {"置顶", "多选", "删除", "取消"}
        ok_a = expect_btns.issubset(set(btns)) and any("测试便签二" in p for p in prev)
        log("A", "右键便签弹出 iOS 底部动作面板(预览+置顶/多选/删除+取消)",
            ok_a, f"按钮={btns}; 预览={prev}")

        # ---------- TEST B:置顶 ----------
        print("== TEST B: pin ==", flush=True)
        page.get_by_role("button", name="置顶", exact=True).click()
        page.wait_for_selector(MENU_SEL, state="detached", timeout=5000)
        wait_stable(900)
        shot(page, "08-pinned")
        cards = note_cards(page)
        order_b = [c["text"] for c in cards]
        pinned_b = [c for c in cards if c["pinned"]]
        toast_b = page.locator('[role="status"]').count() > 0 and "置顶" in (
            page.locator('[role="status"]').first.inner_text() if page.locator('[role="status"]').count() else "")
        ok_b = order_b[0] == "测试便签二" and len(pinned_b) == 1 and pinned_b[0]["text"] == "测试便签二"
        log("B", "置顶 → 便签移到最前 + 「置顶」图钉徽章", ok_b,
            f"顺序={order_b}; 置顶徽章卡片={[c['text'] for c in pinned_b]}; toast含置顶={toast_b}")

        # ---------- TEST C:取消置顶 ----------
        print("== TEST C: unpin ==", flush=True)
        page.locator(CARD_ANY).nth(0).click(button="right")  # 右键已置顶的那张
        page.wait_for_selector(MENU_SEL, timeout=5000)
        wait_stable(500)
        btns_c = menu_buttons(page)
        shot(page, "09-unpin-menu")
        has_unpin = "取消置顶" in btns_c and "置顶" not in btns_c
        page.get_by_role("button", name="取消置顶", exact=True).click()
        page.wait_for_selector(MENU_SEL, state="detached", timeout=5000)
        wait_stable(900)
        shot(page, "10-unpinned")
        cards = note_cards(page)
        order_c = [c["text"] for c in cards]
        ok_c = has_unpin and order_c == ["测试便签三", "测试便签二", "测试便签一"] and not any(c["pinned"] for c in cards)
        log("C", "置顶便签菜单显示「取消置顶」→ 点击后回到时间排序", ok_c,
            f"菜单按钮={btns_c}; 恢复后顺序={order_c}; 无置顶徽章={not any(c['pinned'] for c in cards)}")

        # ---------- TEST D:多选模式 ----------
        print("== TEST D: multi-select ==", flush=True)
        page.locator(CARD_ANY).nth(0).click(button="right")  # 右键「测试便签三」
        page.wait_for_selector(MENU_SEL, timeout=5000)
        page.get_by_role("button", name="多选", exact=True).click()
        page.wait_for_selector('[role="toolbar"][aria-label="便签多选"]', timeout=5000)
        wait_stable(700)
        shot(page, "11-multiselect")
        bar_top = page.locator('[role="toolbar"][aria-label="便签多选"]').inner_text()
        bar_bottom = page.locator('[role="toolbar"][aria-label="便签批量操作"]').inner_text() \
            if page.locator('[role="toolbar"][aria-label="便签批量操作"]').count() else "(无)"
        cards = note_cards(page)
        badges = [c["hasCheckBadge"] for c in cards]
        selected = [c["text"] for c in cards if c["selected"]]
        fab_hidden = page.locator('button[aria-label="钉一张便签"]').count() == 0
        ok_d = ("已选 1 张" in bar_top and "全选" in bar_top and "取消" in bar_top
                and "删除" in bar_bottom and "置顶" in bar_bottom
                and all(badges) and selected == ["测试便签三"] and fab_hidden)
        log("D", "多选模式:顶部工具栏 + 底部操作栏 + 勾选徽章 + 长按项已选",
            ok_d, f"顶部栏={bar_top.splitlines()}; 底部栏={bar_bottom.splitlines()}; "
                  f"徽章全显={all(badges)}; 已选={selected}; FAB隐藏={fab_hidden}")

        # ---------- TEST E:勾第二张 + 批量删除 ----------
        print("== TEST E: batch delete ==", flush=True)
        page.locator(CARD_ANY).nth(2).click()  # 左键点「测试便签一」→ 勾选(多选模式下 aria-label=勾选这张便签)
        wait_stable(600)
        bar_top = page.locator('[role="toolbar"][aria-label="便签多选"]').inner_text()
        shot(page, "12-multiselect-2")
        page.locator('[role="toolbar"][aria-label="便签批量操作"]').get_by_role("button", name="删除 2 张").click()
        wait_stable(900)
        shot(page, "13-batch-deleted")
        cards = note_cards(page)
        toolbar_gone = page.locator('[role="toolbar"][aria-label="便签多选"]').count() == 0
        fab_back = page.locator('button[aria-label="钉一张便签"]').count() == 1
        ok_e = bar_top.replace("\n", "").replace(" ", "").startswith("取消") and "已选2张" in bar_top.replace(" ", "") \
            and [c["text"] for c in cards] == ["测试便签二"] and toolbar_gone and fab_back
        log("E", "多选第 2 张 → 已选 2 张 → 批量删除 → 退出多选",
            ok_e, f"勾选后顶部栏={bar_top.splitlines()}; 删除后剩余={[c['text'] for c in cards]}; "
                  f"工具栏消失={toolbar_gone}; +按钮回归={fab_back}")

        # ---------- TEST F:删除剩余便签 + 二次确认 ----------
        print("== TEST F: single delete with confirm ==", flush=True)
        page.locator(CARD_ANY).nth(0).click(button="right")  # 右键「测试便签二」
        page.wait_for_selector(MENU_SEL, timeout=5000)
        page.get_by_role("button", name="删除", exact=True).click()
        wait_stable(600)
        shot(page, "14-delete-confirm")
        alert = page.locator('[role="alertdialog"]')
        alert_txt = alert.inner_text() if alert.count() else ""
        has_confirm = ("删除后便签和下面的留言都没有了" in alert_txt and "确定取下这张便签吗？" in alert_txt)
        # 也验证「再想想」可取消:回到菜单三按钮态、便签仍在
        page.get_by_role("button", name="再想想", exact=True).click()
        wait_stable(500)
        menu_back = page.locator(MENU_SEL).count() == 1
        btns_after_rethink = menu_buttons(page)
        still_there = len(note_cards(page)) == 1
        # 再来一次,这次真的删(菜单此时仍是三按钮态,直接点菜单里的「删除」)
        page.get_by_role("button", name="删除", exact=True).click()
        wait_stable(400)
        page.locator('[role="alertdialog"]').get_by_role("button", name="删除", exact=True).click()
        wait_stable(900)
        shot(page, "15-all-deleted")
        cards = note_cards(page)
        empty_after = page.locator("text=墙上还空着").count() > 0
        ok_f = has_confirm and still_there and menu_back and len(cards) == 0 and empty_after
        log("F", "删除 → 二次确认弹层 → 确认后便签移除(空墙提示回归);「再想想」可撤销",
            ok_f, f"确认弹层文本={alert_txt.splitlines()}; 再想想后菜单仍在={menu_back}(按钮={btns_after_rethink}); "
                  f"再想想后便签仍在={still_there}; 最终便签数={len(cards)}; 空墙提示={empty_after}")

        # ---------- 汇总 ----------
        shot(page, "16-final-state")
        browser.close()

    summary = {
        "total": len(results),
        "passed": sum(1 for r in results if r["ok"]),
        "failed": [r for r in results if not r["ok"]],
        "results": results,
        "console_errors": console_errors,
        "console_warnings": [c for c in console_errors if c["type"] == "warning"],
        "page_errors": page_errors,
        "failed_requests": failed_requests,
        "board_bg_requests": board_bg_requests,
    }
    REPORT.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n===== SUMMARY =====", flush=True)
    print(f"passed {summary['passed']}/{summary['total']}", flush=True)
    print(f"console errors: {len(console_errors)}; page errors: {len(page_errors)}; "
          f"failed requests: {len(failed_requests)}", flush=True)


if __name__ == "__main__":
    try:
        run()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
