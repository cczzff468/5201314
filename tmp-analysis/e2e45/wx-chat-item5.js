(async () => {
  const input = document.querySelector('[data-testid="wx-chat-input"]');
  if (!input) return 'input-MISSING';
  const yBefore = input.getBoundingClientRect().y;
  const plus = document.querySelector('[data-testid="wx-chat-plus"]');
  if (!plus) return 'plus-MISSING';
  plus.click();
  await new Promise(r => setTimeout(r, 500));
  const yAfter = input.getBoundingClientRect().y;
  const panel = document.querySelector('[data-testid="wx-plus-panel"]');
  if (!panel) return JSON.stringify({ yBefore, yAfter, panel: 'MISSING' });
  const cs = getComputedStyle(panel);
  const pRect = panel.getBoundingClientRect();
  const iRect = input.getBoundingClientRect();
  const rows = [...panel.querySelectorAll('button')].length;
  const inner = panel.firstElementChild;
  return JSON.stringify({
    yBefore: Math.round(yBefore * 10) / 10,
    yAfter: Math.round(yAfter * 10) / 10,
    yUnchanged: Math.abs(yAfter - yBefore) < 0.5,
    panel: {
      cls: panel.className.slice(0, 70),
      bg: cs.backgroundColor,
      blur: cs.backdropFilter,
      radius: cs.borderRadius,
      flexDirection: inner ? getComputedStyle(inner).flexDirection : null,
      rowCount: rows,
      panelBottom: Math.round(pRect.bottom * 10) / 10,
      inputTop: Math.round(iRect.top * 10) / 10,
      floatsAbove: pRect.bottom <= iRect.top + 0.5,
      gap: Math.round((iRect.top - pRect.bottom) * 10) / 10,
    },
  }, null, 1);
})()
