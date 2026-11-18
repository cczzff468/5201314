(async () => {
  const ls = [...document.querySelectorAll('div')].find(d => /z-\[65\]/.test(d.className) && /select-none/.test(d.className));
  if (!ls) return 'no-lockscreen-found';
  const pd = (x,y)=>ls.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:1,clientX:x,clientY:y,pointerType:'touch'}));
  const pm = (x,y)=>ls.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:1,clientX:x,clientY:y,pointerType:'touch'}));
  const pu = (x,y)=>ls.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:1,clientX:x,clientY:y,pointerType:'touch'}));
  pd(195,700);
  for (let y=640; y>=180; y-=40) pm(195,y);
  await new Promise(r=>setTimeout(r,150));
  pu(195,160);
  await new Promise(r=>setTimeout(r,1000));
  const still = [...document.querySelectorAll('div')].some(d => /z-\[65\]/.test(d.className) && /select-none/.test(d.className) && d.getBoundingClientRect().height > 500);
  return 'unlocked=' + (!still);
})()
