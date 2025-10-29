(() => {
  const stage   = document.getElementById('stage');
  const content = document.getElementById('content');
  const zoomDock= stage.querySelector('.zoomDock');
  const panel   = document.getElementById('panel');
  const input   = document.getElementById('proxyInput');
  const toast   = document.getElementById('toast');
  const darkToggle = document.getElementById('darkToggle');
  const startOverlay = document.getElementById('startOverlay');

  /* === 모드 목록: UI 없이 고정 === */
  const MODE_ORDER = ['normal','circle','spiral','wave','tree','spread'];

  function modeLabel(m){ return m[0].toUpperCase()+m.slice(1); }
  function cycleMode(dir){
    const curIdx = MODE_ORDER.indexOf(mode);
    const i = curIdx < 0 ? 0 : curIdx;
    const ni = (i + (dir>0?1:-1) + MODE_ORDER.length) % MODE_ORDER.length;
    const next = MODE_ORDER[ni];
    setMode(next);
    showToast(`Mode: ${modeLabel(next)}`);
  }

  // ===== Mode params =====
  const NORMAL_COLS = 60;
  const NORMAL_STEP_X = 12, NORMAL_STEP_Y = 24;
  const CIRCLE_RADIUS = 120;
  const SPIRAL_A = 3, SPIRAL_B = 0.10;
  const WAVE_A = 60, WAVE_LAMBDA = 200;
  const TREE_SPREAD_BASE = 120, TREE_SPREAD_STEP = 40;
  const TREE_JITTER_X = 8, TREE_JITTER_Y = 5;
  const FIT_PADDING = 40;
  const RANDOM_STEP_X = 18, RANDOM_STEP_Y = 28;
  const RANDOM_JITTER_X = 14, RANDOM_JITTER_Y = 20;
  const RANDOM_SCALE_MIN = 0.6, RANDOM_SCALE_MAX = 1.6;
  const RANDOM_ROT_MAX = Math.PI / 4;

  // Tracking
  let TRACK_LATIN = 0;
  let TRACK_HANGUL = 3;
  const NORMAL_TRACK_LATIN = 0.8;
  const NORMAL_TRACK_HANGUL = 1.8;
  const TRACK_APPLY_MODES = { normal:true, wave:true, circle:false, spiral:false, tree:false, spread:false };

  const measurer=document.createElement('span');
  measurer.className='glyph';
  measurer.style.position='absolute';
  measurer.style.transform='none';
  measurer.style.visibility='hidden';
  measurer.style.pointerEvents='none';
  measurer.style.whiteSpace='pre';
  measurer.style.left='-9999px';
  measurer.style.top='-9999px';
  document.body.appendChild(measurer);
  const widthCache=new Map();
  function measureGlyphWidth(ch){
    const key=ch===' ' ? 'space' : ch;
    if(widthCache.has(key)) return widthCache.get(key);
    measurer.textContent=(ch===' ' ? '\u00A0' : ch);
    const w=measurer.getBoundingClientRect().width||0;
    widthCache.set(key,w);
    return w;
  }

  function isHangul(ch){ const c=ch.codePointAt(0);
    return (c>=0x1100&&c<=0x11FF)||(c>=0x3130&&c<=0x318F)||(c>=0xAC00&&c<=0xD7AF); }
  function isLatin(ch){ const c=ch.codePointAt(0);
    return (c>=0x0041&&c<=0x005A)||(c>=0x0061&&c<=0x007A)||(c>=0x0030&&c<=0x0039); }

  // State
  let mode='normal';
  let glyphs=[];
  let prevText='';
  const pen={ x:0,y:0,z:0,i:0,mode:'normal',anchorX:0,anchorY:0,anchorZ:0,_trackX:0,flowX:0,flowY:0,lineStartX:0 };
  let didAutoFit=false;

  function stageRect(){ return stage.getBoundingClientRect(); }
  function initPen(){
    const r=stageRect();
    pen.anchorX = r.width/2;
    pen.anchorY = r.height/2;
    pen.anchorZ = 0;
    pen.i = 0;
    pen._trackX = 0;
    pen.flowX = pen.anchorX;
    pen.flowY = pen.anchorY;
    pen.lineStartX = pen.anchorX;
    updatePenPosition();
  }

  // Deterministic jitter
  function hash32(x){ let t=x+0x6D2B79F5; t=Math.imul(t ^ (t>>>15), t|1); t^= t + Math.imul(t ^ (t>>>7), t | 61); return ((t ^ (t>>>14))>>>0)/4294967296; }
  function jitter(i, s){ return hash32(i*73856093 + s*19349663) - 0.5; }
  const RAND_BUF = (typeof Uint32Array !== 'undefined') ? new Uint32Array(1) : null;
  function rand(){
    const g=typeof globalThis!=='undefined'?globalThis:null;
    const c=g && g.crypto && typeof g.crypto.getRandomValues==='function' ? g.crypto : null;
    if(c && RAND_BUF){
      c.getRandomValues(RAND_BUF);
      return RAND_BUF[0]/4294967295;
    }
    return Math.random();
  }
  function randomInRange(min,max){ return min + (max - min) * rand(); }

  const stepSize=16;
  const Path={
    normal(i){ const cols=NORMAL_COLS; const row=Math.floor(i/cols), col=i%cols;
      return { dx:col*NORMAL_STEP_X, dy:row*NORMAL_STEP_Y, dz:0, rot:0, scale:1 }; },
    circle(i){ const t=i*(Math.PI/16); return { dx:CIRCLE_RADIUS*Math.cos(t), dy:CIRCLE_RADIUS*Math.sin(t), dz:0, rot:t+Math.PI/2, scale:1 }; },
    spiral(i){ const t=i*(Math.PI/10); const r=SPIRAL_A*Math.exp(SPIRAL_B*t)*6; return { dx:r*Math.cos(t), dy:r*Math.sin(t), dz:0, rot:t+Math.PI/2, scale:1 }; },
    wave(i){ const x=i*stepSize; const y=WAVE_A*Math.sin((2*Math.PI/WAVE_LAMBDA)*x); return { dx:x, dy:y, dz:0, rot:0, scale:1 }; },
    tree(i){ const level=Math.floor(Math.log2(i+1));
      const start=(2**level)-1; const j=i-start; const count=2**level;
      const spread=(TREE_SPREAD_BASE+level*TREE_SPREAD_STEP);
      const jx=jitter(i,1), jy=jitter(i,2);
      const x=((j+0.5)/count-0.5)*spread*2 + jx*level*TREE_JITTER_X;
      const y=level*60 + jy*level*TREE_JITTER_Y;
      return { dx:x, dy:y, dz:0, rot:0, scale:1 };
    },
    spread(i){
      const baseScale = randomInRange(RANDOM_SCALE_MIN, RANDOM_SCALE_MAX);
      const baseRot = (rand()*2 - 1) * RANDOM_ROT_MAX;
      if(i===0){
        const dx0 = (rand()*2 - 1) * RANDOM_STEP_X * 0.5;
        const dy0 = (rand()*2 - 1) * RANDOM_STEP_Y * 0.5;
        return { dx:dx0, dy:dy0, dz:0, rot:baseRot, scale:baseScale };
      }
      const radialBase = Math.sqrt(i + 1) * RANDOM_STEP_Y;
      const radius = randomInRange(radialBase * 0.65, radialBase * 1.35 + RANDOM_JITTER_Y);
      const angle = rand() * Math.PI * 2;
      const jitterX = (rand()*2 - 1) * RANDOM_JITTER_X;
      const jitterY = (rand()*2 - 1) * RANDOM_JITTER_Y;
      const dx = Math.cos(angle) * radius + jitterX;
      const dy = Math.sin(angle) * radius + jitterY;
      return { dx, dy, dz:0, rot:baseRot, scale:baseScale };
    }
  };
  function getPath(n){ return Path[n]||Path.normal; }

  // Caret
  const caret=document.createElement('div');
  caret.className='glyph caret is-active';
  caret.textContent='';
  content.appendChild(caret);
  function updatePenPosition(){
    if(pen.mode==='normal'){
      pen.x = pen.flowX;
      pen.y = pen.flowY;
      pen.z = pen.anchorZ;
      return;
    }
    const p=getPath(pen.mode)(pen.i);
    const trackX = TRACK_APPLY_MODES[pen.mode] ? (pen._trackX || 0) : 0;
    pen.x = pen.anchorX + p.dx + trackX;
    pen.y = pen.anchorY + p.dy;
    pen.z = pen.anchorZ + p.dz;
  }
  const CARET_VIEW_MARGIN = 80;

  function placeCaret(){
    caret.style.transform=`translate3d(${pen.x}px, ${pen.y}px, ${pen.z}px)`;
  }

  function ensureCaretInView(){
    const rect=stageRect();
    if(!rect) return;
    const margin=CARET_VIEW_MARGIN;
    const caretScreenX = pen.x * zoom + offsetX;
    const caretScreenY = pen.y * zoom + offsetY;
    let changed=false;
    if(caretScreenX < margin){
      offsetX += margin - caretScreenX;
      changed=true;
    } else if(caretScreenX > rect.width - margin){
      offsetX += (rect.width - margin) - caretScreenX;
      changed=true;
    }
    if(caretScreenY < margin){
      offsetY += margin - caretScreenY;
      changed=true;
    } else if(caretScreenY > rect.height - margin){
      offsetY += (rect.height - margin) - caretScreenY;
      changed=true;
    }
    if(changed){
      applyView();
    }
  }

  function syncCaret(){
    placeCaret();
    ensureCaretInView();
  }

  function hideStartOverlay(){
    if(startOverlay && !startOverlay.classList.contains('is-hidden')){
      startOverlay.classList.add('is-hidden');
    }
    caret.classList.add('is-active');
  }

  function placeNextChar(ch){
    hideStartOverlay();
    if (ch === '\n'){
      if(pen.mode==='normal'){
        pen.anchorY = pen.anchorY + NORMAL_STEP_Y;
        pen.flowY = pen.anchorY;
        pen.flowX = pen.lineStartX;
        pen.i = 0;
        updatePenPosition();
        syncCaret(); maybeAutoFit(); return;
      }
      pen.anchorY = pen.anchorY + NORMAL_STEP_Y;
      pen.i = 0;
      pen._trackX = 0;
      updatePenPosition();
      syncCaret(); maybeAutoFit(); return;
    }

    if(pen.mode==='normal'){
      const baseWidth = measureGlyphWidth(ch);
      const tracking = isHangul(ch) ? NORMAL_TRACK_HANGUL : NORMAL_TRACK_LATIN;
      const x = pen.flowX;
      const y = pen.flowY;
      const z = pen.anchorZ;
      const el=document.createElement('div');
      el.className='glyph';
      el.textContent = (ch===' ' ? ' ' : ch);
      el.style.transform = `translate3d(${x}px, ${y}px, ${z}px)`;
      content.appendChild(el);
      const advance = baseWidth + tracking;
      glyphs.push({el,ch,x,y,z,scale:1,trackDelta:0,width:baseWidth,advance,mode:'normal'});
      pen.flowX = x + advance;
      pen.i += 1;
      updatePenPosition();
      syncCaret(); maybeAutoFit();
      return;
    }

    const p=getPath(pen.mode)(pen.i);
    let extraX=0;
    let trackDelta=0;
    if (TRACK_APPLY_MODES[pen.mode]){
      const t = isHangul(ch) ? TRACK_HANGUL : TRACK_LATIN;
      extraX = pen._trackX || 0;
      trackDelta = t;
      pen._trackX = (pen._trackX || 0) + t;
    }
    const x=pen.anchorX + p.dx + extraX, y=pen.anchorY + p.dy, z=pen.anchorZ + p.dz;

    const el=document.createElement('div');
    el.className='glyph';
    el.textContent = (ch===' ' ? ' ' : ch);
    const transforms = [`translate3d(${x}px, ${y}px, ${z}px)`];
    if (p.rot){
      transforms.push(`rotate(${p.rot}rad)`);
    }
    if (p.scale && p.scale !== 1){
      transforms.push(`scale(${p.scale})`);
    }
    el.style.transform = transforms.join(' ');

    content.appendChild(el);
    const baseWidth = measureGlyphWidth(ch);
    const scaledWidth = baseWidth * (p.scale || 1);
    glyphs.push({el,ch,x,y,z,scale:p.scale||1,trackDelta,width:scaledWidth,mode:pen.mode});

    pen.i+=1;
    updatePenPosition();
    syncCaret(); maybeAutoFit();
  }

  function backspaceOne(){
    if(!glyphs.length) return;
    const g=glyphs.pop(); g.el.remove();
    if(g.mode==='normal'){
      pen.flowX = g.x;
      pen.flowY = g.y;
      pen.i=Math.max(0,pen.i-1);
      updatePenPosition();
      syncCaret();
      clearSelectionVisual();
      return;
    }
    const delta = g.trackDelta || 0;
    if(delta){
      pen._trackX = Math.max(0, (pen._trackX || 0) - delta);
    }
    pen.i=Math.max(0,pen.i-1);
    if(pen.i===0){ pen._trackX = 0; }
    updatePenPosition();
    syncCaret();
  }

  function maybeAutoFit(){ /* auto-fit disabled by request */ }

  // Strict append-only
  const STRICT_APPEND=true;
  let composing=false;
  input.addEventListener('compositionstart', ()=> composing=true);
  input.addEventListener('compositionend',  ()=>{ composing=false; processInput(); });
  input.addEventListener('input',           ()=>{ if(!composing) processInput(); });

  function showToast(msg){
    if (!toast) return;
    toast.textContent=msg; toast.hidden=false; toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t=setTimeout(()=>{ toast.classList.remove('show'); toast.hidden=true; }, 1200);
  }

  function processInput(){
    const cur=input.value; const selStart=input.selectionStart; const isTail=(selStart===cur.length);
    if(cur.startsWith(prevText)){ const appended=cur.slice(prevText.length); for(const ch of appended) placeNextChar(ch); prevText=cur; return; }
    if(prevText.startsWith(cur) && isTail){ const n=prevText.length-cur.length; for(let i=0;i<n;i++) backspaceOne(); prevText=cur; return; }
    if(STRICT_APPEND){
      input.value=prevText; input.setSelectionRange(prevText.length,prevText.length);
      showToast('중간 편집은 이어쓰기 모드에서 허용되지 않습니다.'); return;
    }
    content.querySelectorAll('.glyph').forEach(n=>n.remove()); glyphs=[]; initPen(); syncCaret();
    for(const ch of cur) placeNextChar(ch); prevText=cur;
  }

  // Mode switch (Tab 전용)
  function setMode(newMode){
    mode=newMode;
    pen.mode=mode; pen.anchorX=pen.x; pen.anchorY=pen.y; pen.anchorZ=pen.z; pen.i=0; pen._trackX=0; updatePenPosition(); syncCaret();
    focusToTextarea();
  }

  function focusToTextarea(){
    requestAnimationFrame(()=>{
      input.focus({ preventScroll:true });
      const len=input.value.length; try{ input.setSelectionRange(len,len); }catch(_){}
    });
  }

  // Dark mode
  function toggleDarkMode(){
    const isDark=document.documentElement.getAttribute('data-theme')==='dark';
    const next=isDark?'light':'dark';
    document.documentElement.setAttribute('data-theme', next);
    darkToggle.textContent = isDark ? '🌙' : '☀️';
    localStorage.setItem('theme', next);
  }
  function initDarkMode(){
    const saved=localStorage.getItem('theme')||'light';
    document.documentElement.setAttribute('data-theme', saved);
    darkToggle.textContent = saved==='dark' ? '☀️' : '🌙';
  }

  // 패널(다크 토글만 존재)
  panel.addEventListener('pointerdown', (e)=> e.stopPropagation());
  panel.addEventListener('pointerup',   (e)=> e.stopPropagation());
  panel.addEventListener('click',       (e)=> e.stopPropagation());
  darkToggle.addEventListener('click', toggleDarkMode);

  // ===== Keyboard: Tab cycle (Space는 선택 보조경로로 유지하지 않음) =====
  window.addEventListener('keydown', (e)=>{ 
    if(e.key==='Tab'){
      if (typeof composing !== 'undefined' && composing) return;
      e.preventDefault();
      cycleMode(e.shiftKey ? -1 : 1);
    }
  });

  // ===== Zoom & Pan =====
  let zoom=1, offsetX=0, offsetY=0; const minZoom=0.3, maxZoom=4; const ZOOM_STEP=1.2;
  function clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }
  function updateZoomDisplay(){ const btn=zoomDock.querySelector('[data-zoom="reset"]'); if(btn) btn.textContent=Math.round(zoom*100)+'%'; }
  function applyView(){ content.style.transform=`translate(${offsetX}px, ${offsetY}px) scale(${zoom})`; updateZoomDisplay(); }
  function zoomAt(cx,cy,f){ const nz=clamp(zoom*f,minZoom,maxZoom); const px=(cx-offsetX)/zoom; const py=(cy-offsetY)/zoom; zoom=nz; offsetX=cx-px*zoom; offsetY=cy-py*zoom; applyView(); }
  function contentBounds(){ if(!glyphs.length) return {minX:0,minY:0,maxX:1,maxY:1}; let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity; glyphs.forEach(g=>{minX=Math.min(minX,g.x);minY=Math.min(minY,g.y);maxX=Math.max(maxX,g.x);maxY=Math.max(maxY,g.y);}); return {minX,minY,maxX,maxY}; }
  function fitToView(){ const r=stageRect(); const b=contentBounds(); const w=Math.max(1,b.maxX-b.minX+FIT_PADDING*2); const h=Math.max(1,b.maxY-b.minY+FIT_PADDING*2); const s=Math.min(r.width/w,r.height/h); zoom=clamp(s,minZoom,maxZoom); offsetX=(r.width-(b.maxX-b.minX)*zoom)/2 - b.minX*zoom; offsetY=(r.height-(b.maxY-b.minY)*zoom)/2 - b.minY*zoom; applyView(); }
  function resetView(){
    zoom=1;
    offsetX=0;
    offsetY=0;
    applyView();
  }

  function toContentCoords(clientX, clientY){
    const r=stageRect(); const sx=clientX-r.left; const sy=clientY-r.top;
    return { x:(sx-offsetX)/zoom, y:(sy-offsetY)/zoom };
  }

  // 휠 줌
  let lastWheel=0;
  stage.addEventListener('wheel', (e)=>{
    e.preventDefault();
    const now=performance.now(); if(now-lastWheel<16) return; lastWheel=now;
    const rect=stageRect(); const cx=e.clientX-rect.left, cy=e.clientY-rect.top;
    const factor=Math.pow(1.1,-Math.sign(e.deltaY)); zoomAt(cx,cy,factor); updateZoomDisplay();
  }, {passive:false});

  zoomDock.addEventListener('click', (e)=>{
    const btn=e.target.closest('.zbtn');
    if(!btn) return;
    const action=btn.dataset.zoom;
    if(action==='in' || action==='out'){
      const rect=stageRect();
      const factor=action==='in' ? ZOOM_STEP : 1/ZOOM_STEP;
      zoomAt(rect.width/2, rect.height/2, factor);
    } else if(action==='reset'){
      resetView();
    } else if(action==='fit'){
      fitToView();
    }
    e.preventDefault();
  });

  // ===== Drag to pan (Space 없이) + Click-to-type 보호 =====
  let panCandidate=false, dragging=false, lastX=0,lastY=0, downX=0, downY=0;
  const DRAG_THRESHOLD=4;
  let restoreFocusAfterDrag=false;

  function isUIHit(target){
    return !!(target.closest('.panel') || target.closest('.zoomDock'));
  }

  stage.addEventListener('pointerdown', (e)=>{
    if (isUIHit(e.target)) return;      // UI 위에서는 제스처 시작 금지
    panCandidate=true; dragging=false;
    downX=lastX=e.clientX; downY=lastY=e.clientY;
    stage.setPointerCapture(e.pointerId);
    e.preventDefault();                 // 모바일 스크롤/텍스트 선택 방지
  });

  stage.addEventListener('pointermove', (e)=>{
    if(!panCandidate && !dragging) return;
    const dx=e.clientX-lastX, dy=e.clientY-lastY;
    const movedTotal=Math.hypot(e.clientX-downX, e.clientY-downY);

    if(!dragging){
      if(movedTotal>DRAG_THRESHOLD){
        dragging=true;
        stage.classList.add('dragging');
        restoreFocusAfterDrag=true;
      } else {
        return; // 아직 클릭 판단 구간
      }
    }

    offsetX+=dx; offsetY+=dy;
    lastX=e.clientX; lastY=e.clientY;
    applyView();
    e.preventDefault();
  });

  function endPointer(e){
    if(dragging){
      dragging=false; stage.classList.remove('dragging');
      if (restoreFocusAfterDrag){ restoreFocusAfterDrag=false; focusToTextarea(); }
      panCandidate=false;
      return; // 패닝 제스처였다면 커서 이동 없음
    }

    if(!panCandidate) return;
    panCandidate=false;

    // 클릭-투-타입 (threshold 이하로 움직였을 때만)
    const moved=Math.hypot(e.clientX-downX, e.clientY-downY);
    if(moved<=DRAG_THRESHOLD && e.button!==1){
      const {x,y}=toContentCoords(e.clientX, e.clientY);
      pen.anchorX=x; pen.anchorY=y; pen.anchorZ=0; 
      pen.i=0; pen._trackX=0;
      updatePenPosition();
      syncCaret(); focusToTextarea();
    }
  }

  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);

  // Keep typing flowing to proxy input even if stage has focus
  stage.addEventListener('keydown', (e)=>{
    if(document.activeElement!==input){ focusToTextarea(); }
  });

  // init
  document.documentElement.style.setProperty('--anim-ms','800');
  initDarkMode();
  initPen(); syncCaret(); applyView();
  if(input.value.length){ hideStartOverlay(); }
  focusToTextarea();

  // On resize, keep fit if nothing typed yet; else maintain current view
  window.addEventListener('resize', ()=>{ if(!glyphs.length){ applyView(); } });
})();
