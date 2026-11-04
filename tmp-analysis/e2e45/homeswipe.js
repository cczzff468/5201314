(async () => {
  const p2 = document.querySelector('[data-testid="home-page-2"]');
  if (!p2) return 'no-page2';
  const track = p2.parentElement;
  const start = getComputedStyle(track).transform;
  const pt = 'touch';
  const pd = (x,y)=>track.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:9,clientX:x,clientY:y,pointerType:pt}));
  const pm = (x,y)=>track.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:9,clientX:x,clientY:y,pointerType:pt}));
  const pu = (x,y)=>track.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:9,clientX:x,clientY:y,pointerType:pt}));
  pd(300,400);
  for (let x=250; x>=-100; x-=25) pm(x,400);
  await new Promise(r=>setTimeout(r,150));
  pu(-100,400);
  await new Promise(r=>setTimeout(r,700));
  const after = getComputedStyle(track).transform;
  const wx = [...document.querySelectorAll('[aria-label="打开微信"]')].map(e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y)}});
  return JSON.stringify({start, after, wx});
})()
