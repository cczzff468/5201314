(async () => {
  // find a peer text bubble (凡凡's message f5: '要画完那张稿子…')
  const row = document.querySelector('[data-mid="f5"]') || [...document.querySelectorAll('[data-mid]')].find(r => /稿子/.test(r.textContent));
  if (!row) return 'row-not-found';
  // bubble = the inner element with press handlers; try direct child text container
  const bubble = row.querySelector('[class*="bub-"]') || row.querySelector('div p')?.parentElement || row;
  const r = bubble.getBoundingClientRect();
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  bubble.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 3, clientX: x, clientY: y, pointerType: 'touch' }));
  await new Promise(res => setTimeout(res, 650));
  bubble.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 3, clientX: x, clientY: y, pointerType: 'touch' }));
  await new Promise(res => setTimeout(res, 600));
  const card = document.querySelector('[data-testid="wx-menu-card"]');
  if (!card) return 'card-MISSING (bubbleCls=' + bubble.className.slice(0, 80) + ')';
  const cs = getComputedStyle(card);
  const cRect = card.getBoundingClientRect();
  const firstRow = card.querySelector('button');
  const rowCs = firstRow ? getComputedStyle(firstRow) : null;
  const icon = firstRow ? firstRow.querySelector('svg, svg *') : null;
  const svgEl = firstRow ? firstRow.querySelector('svg') : null;
  const label = firstRow ? firstRow.querySelector('span') : null;
  const items = [...card.querySelectorAll('button')].map(b => b.textContent.trim());
  return JSON.stringify({
    card: { cls: card.className.slice(0, 90), w: Math.round(cRect.width), h: Math.round(cRect.height), bg: cs.backgroundColor, blur: cs.backdropFilter, radius: cs.borderRadius, gridCols: cs.gridTemplateColumns ? cs.gridTemplateColumns.split(' ').length : null },
    rowH: rowCs ? rowCs.height : null,
    iconSize: svgEl ? { w: svgEl.getBoundingClientRect().width, h: svgEl.getBoundingClientRect().height, attrW: svgEl.getAttribute('width'), attrH: svgEl.getAttribute('height') } : null,
    labelSize: label ? getComputedStyle(label).fontSize : null,
    items, itemCount: items.length,
  }, null, 1);
})()
