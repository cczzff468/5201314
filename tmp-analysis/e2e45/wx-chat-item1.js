(() => {
  const out = {};
  // --- Item 1: topbar no mask + name capsule ---
  const nameWrap = document.querySelector('[data-testid="wx-chat-peer-name"]');
  const capsule = nameWrap ? nameWrap.querySelector('span') : null;
  // topbar wrapper: the parent chain of the name area - find via data-liquid-theme root -> first div child with pt-[42px]
  const root = document.querySelector('[data-liquid-theme="true"]');
  const topbar = root ? root.querySelector(':scope > div.pt-\\[42px\\]') || [...root.children].find(c => /pt-\[42px\]/.test(c.className)) : null;
  if (topbar) {
    const cs = getComputedStyle(topbar);
    out.topbar = { cls: topbar.className.slice(0, 110), backdropFilter: cs.backdropFilter, webkitBF: cs.webkitBackdropFilter, bg: cs.backgroundColor, position: cs.position, pointerEvents: cs.pointerEvents };
  } else out.topbar = 'NOT-FOUND';
  if (capsule) {
    const cs = getComputedStyle(capsule);
    const r = capsule.getBoundingClientRect();
    out.nameCapsule = { hasLgTitle: capsule.className.includes('lg-title'), bg: cs.backgroundColor, blur: cs.backdropFilter, radius: cs.borderRadius, fontWeight: cs.fontWeight, fontSize: cs.fontSize, w: Math.round(r.width), h: Math.round(r.height), text: capsule.textContent.trim() };
  } else out.nameCapsule = 'MISSING';
  // back button chip
  const back = document.querySelector('[data-testid="wx-chat-back"]');
  out.backBtn = back ? { chip: back.className.includes('lg-chip'), w: back.getBoundingClientRect().width } : 'MISSING';
  return JSON.stringify(out, null, 1);
})()
