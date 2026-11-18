(() => {
  const cs = (el) => el ? getComputedStyle(el) : null;
  const out = {};
  // --- Item 3: category seg bar ---
  const seg = document.querySelector('.lg-seg');
  const segBtns = seg ? [...seg.querySelectorAll('button')].map(b => b.textContent.trim()) : [];
  const segOn = seg ? seg.querySelector('.lg-seg-on') : null;
  out.seg = seg ? {
    bg: cs(seg).backgroundColor,
    blur: cs(seg).backdropFilter,
    tabs: segBtns,
    tabsCount: segBtns.length,
    hasWorkFamily: segBtns.some(t => /工作|家人/.test(t)),
    selOn: segOn ? { text: segOn.textContent.trim(), bg: cs(segOn).backgroundColor, color: cs(segOn).color } : null,
  } : 'MISSING';
  // --- Item 2: TabBar ---
  const active = document.querySelector('[data-testid="wx-tab-chats"]');
  const inactive = document.querySelector('[data-testid="wx-tab-discover"]');
  const tabbar = active ? active.closest('div') : null;
  const activeCapsule = active ? active.querySelector('span > span') : null; // first inner span = capsule
  const activeSvg = active ? active.querySelector('svg') : null;
  const inactiveSvg = inactive ? inactive.querySelector('svg') : null;
  const labelVisible = active ? [...active.querySelectorAll('span')].some(s => s.textContent.trim() === '微信') : null;
  out.tabbar = {
    tabbarCls: tabbar ? tabbar.parentElement.className.slice(0, 60) : null,
    activeCapsule: activeCapsule ? { w: activeCapsule.getBoundingClientRect().width, h: activeCapsule.getBoundingClientRect().height, bg: cs(activeCapsule).backgroundColor, radius: cs(activeCapsule).borderRadius } : 'MISSING',
    activeSvgFill: activeSvg ? cs(activeSvg).fill : null,
    activeSvgColor: activeSvg ? cs(activeSvg).color : null,
    inactiveSvgFill: inactiveSvg ? cs(inactiveSvg).fill : null,
    inactiveSvgColor: inactiveSvg ? cs(inactiveSvg).color : null,
    hasTextLabelChats: labelVisible,
  };
  // --- Item 4: wx-plus black circle ---
  const plus = document.querySelector('[data-testid="wx-plus"]');
  if (plus) {
    const inner = plus.querySelector('span');
    const innerSvg = plus.querySelector('svg');
    out.wxPlus = {
      chip: plus.className.includes('lg-chip'),
      plusCls: plus.className.slice(0, 80),
      bg: cs(plus).backgroundColor,
      blur: cs(plus).backdropFilter,
      w: plus.getBoundingClientRect().width, h: plus.getBoundingClientRect().height,
      inner: inner ? { w: inner.getBoundingClientRect().width, h: inner.getBoundingClientRect().height, border: inner.style.border || cs(inner).borderWidth + ' ' + cs(inner).borderStyle + ' ' + cs(inner).borderColor, radius: cs(inner).borderRadius } : 'MISSING',
    };
  } else out.wxPlus = 'MISSING';
  // --- lg-panel count (pinned / non-pinned) ---
  const panels = [...document.querySelectorAll('.lg-panel')];
  out.lgPanels = { count: panels.length, rects: panels.map(p => { const r = p.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bg: cs(p).backgroundColor }; }) };
  // root bg
  const root = document.querySelector('[data-liquid-theme="true"]');
  out.root = root ? { bg: cs(root).backgroundColor } : 'no-data-liquid-root';
  return JSON.stringify(out, null, 1);
})()
