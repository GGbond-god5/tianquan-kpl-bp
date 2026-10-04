/* Team choices are the bundled club catalogue, not a live season roster. */
(function () {
  const teams = [
    ['成都AG超玩会','ag.webp'],['广州TTG','ttg.webp'],['武汉eStarPro','estar.webp'],
    ['南京Hero久竞','hero.webp'],['重庆狼队','wolves.webp'],['上海RNG.M','rng.webp'],
    ['长沙TES.A','tes.webp'],['深圳DYG','dyg.png'],['上海EDG.M','edg.webp'],
    ['北京JDG','jdg.png'],['苏州KSG','ksg.webp'],['杭州LGD.NBW','lgd.webp'],
    ['济南RW侠','rw.webp'],['北京WB','wb.webp']
  ];
  const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  window.KPLTeams = { logo(name) { return teams.find(t=>t[0]===name)?.[1] || 'kpl-blue.png'; }, mount() {
    ['blue-name','red-name','join-team-name'].forEach(id => {
      const input = document.getElementById(id);
      input.maxLength = 24;
      const box = document.createElement('div'); box.className = 'team-picker';
      const tabs = document.createElement('div'); tabs.className = 'team-picker-tabs';
      tabs.setAttribute('role','tablist'); tabs.setAttribute('aria-label','队伍类型');
      const clubs = document.createElement('button'); clubs.type='button'; clubs.textContent='KPL 队伍';
      const custom = document.createElement('button'); custom.type='button'; custom.textContent='自定义队伍';
      const grid = document.createElement('div'); grid.className='team-choice-grid'; grid.id=id+'-clubs';
      grid.setAttribute('role','tabpanel');
      grid.setAttribute('aria-label','滑动选择战队');
      const carousel = document.createElement('div'); carousel.className='team-carousel';
      const previous = document.createElement('button'), next = document.createElement('button');
      [previous,next].forEach((button,i)=>{
        button.type='button'; button.className='team-scroll'; button.textContent=i?'›':'‹';
        button.setAttribute('aria-label',i?'后面的战队':'前面的战队');
        button.setAttribute('aria-controls',grid.id);
        button.onclick=()=>grid.scrollBy({left:(i?1:-1)*grid.clientWidth*.8,behavior:motionBehavior()});
      });
      const motionBehavior = () => matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth';
      const revealChoice = button => grid.scrollTo({left:button.offsetLeft-(grid.clientWidth-button.offsetWidth)/2,behavior:motionBehavior()});
      const updateArrows = () => {previous.disabled=grid.scrollLeft<2;next.disabled=grid.scrollLeft>=grid.scrollWidth-grid.clientWidth-2;};
      grid.addEventListener('scroll',updateArrows,{passive:true});
      new ResizeObserver(updateArrows).observe(grid);
      grid.addEventListener('wheel',e=>{
        if(e.ctrlKey || Math.abs(e.deltaX)>Math.abs(e.deltaY))return;
        const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?grid.clientWidth:1);
        if((delta>0 && grid.scrollLeft<grid.scrollWidth-grid.clientWidth-2)||(delta<0 && grid.scrollLeft>0)){
          e.preventDefault(); grid.scrollLeft+=delta;
        }
      },{passive:false});
      grid.addEventListener('keydown',e=>{
        const index=[...grid.children].indexOf(e.target);
        if(index<0 || !['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
        e.preventDefault();
        const target=grid.children[e.key==='Home'?0:e.key==='End'?grid.children.length-1:Math.max(0,Math.min(grid.children.length-1,index+(e.key==='ArrowRight'?1:-1)))];
        target.focus({preventScroll:true});target.click();
      });
      carousel.append(previous,grid,next);
      tabs.append(clubs,custom); box.append(tabs,carousel); input.before(box);
      let customName = input.value;
      const setMode = isCustom => {
        clubs.classList.toggle('active',!isCustom); custom.classList.toggle('active',isCustom);
        clubs.setAttribute('aria-selected',String(!isCustom)); custom.setAttribute('aria-selected',String(isCustom));
        carousel.hidden=isCustom; grid.hidden=isCustom; input.hidden=!isCustom; input.readOnly=!isCustom;
        if (isCustom) { input.value=customName; input.focus(); }
        else { const selected=grid.querySelector('[aria-pressed="true"]') || grid.firstElementChild; selected.click(); }
      };
      [clubs,custom].forEach(b=>{b.setAttribute('role','tab');b.setAttribute('aria-controls',b===clubs?grid.id:input.id);});
      teams.forEach(([name,file])=>{
        const b=document.createElement('button'); b.type='button'; b.className='team-choice'; b.setAttribute('aria-pressed','false');
        b.innerHTML=`<img src="js/teams/${file}" alt=""><span>${name}</span>`;
        b.onclick=()=>{
          grid.querySelectorAll('button').forEach(x=>{x.setAttribute('aria-pressed',String(x===b));x.tabIndex=x===b?0:-1;});
          input.value=name; revealChoice(b);
        };
        grid.append(b);
      });
      input.addEventListener('input',()=>{if(!input.readOnly)customName=input.value;});
      clubs.onclick=()=>setMode(false); custom.onclick=()=>setMode(true);
      tabs.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const next=e.target===clubs?custom:clubs;next.click();next.focus();}});
      // Joining may keep the room owner's chosen opponent name.
      setMode(id==='join-team-name');
      if(id==='red-name')grid.children[4].click();
      requestAnimationFrame(()=>{const selected=grid.querySelector('[aria-pressed="true"]');if(selected)revealChoice(selected);updateArrows();});
    });
  }};
  // A minute-scale forecast from the four saved phase estimates. The extra points
  // are interpolation, not observed match events; the original anchors stay intact.
  function phaseTimeline(phases, opening) {
    if (phases.length !== 4) return phases.map((p,i)=>({...p,step:i}));
    const minutes = [0,4,12,19,26];
    const values = [Number.isFinite(opening) ? opening : phases[0].blueWin,
      ...phases.map(p=>p.blueWin)];
    const slopes = values.slice(1).map((v,i)=>(v-values[i])/(minutes[i+1]-minutes[i]));
    const tangents = values.map((_,i)=>{
      if(i===0)return slopes[0];
      if(i===4)return slopes[3];
      const a=slopes[i-1],b=slopes[i];
      return a*b<=0?0:2*a*b/(a+b);
    });
    return Array.from({length:27},(_,minute)=>{
      const segment=Math.min(3,minutes.findIndex((m,i)=>i<4&&minute>=m&&minute<=minutes[i+1]));
      const i=Math.max(0,segment), width=minutes[i+1]-minutes[i];
      const t=(minute-minutes[i])/width, t2=t*t, t3=t2*t;
      const value=(2*t3-3*t2+1)*values[i]+(t3-2*t2+t)*width*tangents[i]+
        (-2*t3+3*t2)*values[i+1]+(t3-t2)*width*tangents[i+1];
      const anchor=minutes.indexOf(minute);
      return {step:minute,minute,blueWin:Math.max(Math.min(values[i],values[i+1]),
        Math.min(Math.max(values[i],values[i+1]),value)),
        label:anchor===0?'BP 开局':anchor>0?phases[anchor-1].label:undefined,
        t:anchor>0?phases[anchor-1].t:undefined,anchor:anchor>0};
    });
  }
  let chartId = 0;
  window.KPLTrend = { render(container, d, blue, red, options = {}) {
    if (!container) return;
    const time = options.mode === 'time';
    const raw = (time ? options.phases || [] : d?.winRateHistory || []).filter(p => Number.isFinite(p?.blueWin));
    const opening = !d?.swapped && d?.winRateHistory?.length ? d.winRateHistory.at(-1)?.blueWin : undefined;
    const prepared = time ? phaseTimeline(raw,opening) : raw;
    const data = prepared.map((p, i) => ({...p, step: time ? p.step : Number.isFinite(p.step) ? p.step : i + 1,
      blueWin: Math.max(0, Math.min(1, p.blueWin))}));
    // The neutral opening is a reference, never a substitute for missing saved data.
    const points = time || !data.length ? data : [{step: 0, blueWin: .5, hero: '开局基准'}, ...data];
    const id = 'kpl-trend-' + (++chartId);
    const W = 960, H = 320, L = 30, R = 852, T = 24, B = 252, M = (T + B) / 2;
    const maxStep = time ? raw.length===4?26:Math.max(1, points.length - 1) : Math.max(d?.isPeak ? 10 : 20, ...points.map(p => p.step));
    const maxDeviation = Math.max(0, ...points.map(p => Math.abs(p.blueWin - .5) * 100));
    // A close matchup can move by less than one point. Label the tighter axis
    // explicitly instead of visually flattening every such forecast at ±5 pp.
    const extent = time ? ([.5,1,2,5,10,20,50].find(n=>n>=maxDeviation*1.15) || 50) :
      Math.min(50, Math.max(5, Math.ceil(maxDeviation / 5) * 5));
    const x = p => L + p.step / maxStep * (R - L);
    const y = p => M - (p.blueWin - .5) * 100 / extent * (B - T) / 2;
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(2)},${y(p).toFixed(2)}`).join(' ');
    const area = points.length ? `${line} L${x(points.at(-1))},${M} L${x(points[0])},${M} Z` : '';
    const last = points.at(-1);
    const prob = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}<span>%</span>` : '—';
    const row = (side, name, value) => `<div class="trend-team ${side}"><img src="js/teams/${window.KPLTeams.logo(name)}" alt=""><div><small>${side === 'blue' ? 'BLUE SIDE' : 'RED SIDE'}</small><strong>${esc(name || (side === 'blue' ? '蓝方' : '红方'))}</strong></div><div class="trend-metric"><b>${prob(value)}</b><em>${time ? esc(last?.label || '阶段') + '预测' : 'BP 预测胜率'}</em></div></div>`;
    const ticks = time && raw.length===4 ? [0,5,10,15,20,25].map(step=>({step,label:step+' 分',sub:''})) : time ? points.map(p => ({step: p.step, label: p.label, sub: p.t || ''})) :
      [0, .25, .5, .75, 1].map(f => ({step: maxStep * f, label: Math.round(maxStep * f) + ' 手', sub: ''}));
    const description = p => time ? `${p.minute??p.step} 分钟 · ${p.label || '阶段模型插值'}${p.t ? ' · ' + p.t : ''}` :
      p.step ? `第 ${p.step} 手${p.side ? ' · ' + (p.side === 'blue' ? blue : red) : ''}${p.type ? ' · ' + (p.type === 'ban' ? 'Ban' : 'Pick') : ''}${p.hero ? ' · ' + p.hero : ''}` : '开局基准';
    const empty = time ? '这条记录没有可用的阶段预测' : d?.actions || !d ? '尚未确认英雄，等待 BP 数据' : '这条历史记录未保存逐手 BP 数据';
    container.innerHTML = `<div class="broadcast-trend finals-trend" data-chart-mode="${time ? 'time' : 'bp'}">
      <div class="trend-heading"><span>胜率走势 <small>WIN PROBABILITY</small></span><span>${time ? '阶段预测' : 'BAN / PICK'}</span></div>
      ${row('blue', blue, last?.blueWin)}<div class="trend-plot"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${time ? '阶段' : 'BP'}胜率面积图；中线为均势，蓝方胜率 50%；正负值为相对中线的百分点变化">
      <defs><linearGradient id="${id}-blue" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#6ea4d2" stop-opacity=".7"/><stop offset="1" stop-color="#517bb0" stop-opacity=".18"/></linearGradient><linearGradient id="${id}-red" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#a0779e" stop-opacity=".15"/><stop offset="1" stop-color="#946481" stop-opacity=".65"/></linearGradient><clipPath id="${id}-upper"><rect x="${L}" y="${T}" width="${R-L}" height="${M-T}"/></clipPath><clipPath id="${id}-lower"><rect x="${L}" y="${M}" width="${R-L}" height="${B-M}"/></clipPath></defs>
      ${[-1, -.5, 0, .5, 1].map(v => `<line class="trend-gridline${v === 0 ? ' trend-baseline' : ''}" x1="${L}" x2="${R}" y1="${M-v*(B-T)/2}" y2="${M-v*(B-T)/2}" stroke="${v === 0 ? '#ccd4e5' : '#66728e'}" stroke-opacity="${v === 0 ? .68 : .28}"/>${Math.abs(v) === 1 || v === 0 ? `<text x="874" y="${M-v*(B-T)/2+5}" fill="#c2cadb" font-size="15">${v === 0 ? '0 pp' : `${v > 0 ? '+' : '−'}${extent} pp`}</text>` : ''}`).join('')}
      ${area ? `<path class="trend-area blue" d="${area}" fill="url(#${id}-blue)" clip-path="url(#${id}-upper)"/><path class="trend-area red" d="${area}" fill="url(#${id}-red)" clip-path="url(#${id}-lower)"/><path class="trend-outline" d="${line}" fill="none" stroke="#98b6d9" stroke-width="2" stroke-linejoin="round"/>` : `<text x="${(L+R)/2}" y="${M-28}" text-anchor="middle" fill="#a5afc1" font-size="18">${empty}</text>`}
      ${time&&raw.length===4?points.filter(p=>p.anchor).map(p=>`<g class="trend-anchor"><line x1="${x(p)}" x2="${x(p)}" y1="${T}" y2="${B}" stroke="#b8c8d6" stroke-opacity=".18" stroke-dasharray="3 6"/><circle cx="${x(p)}" cy="${y(p)}" r="5" fill="#d8e7f8" stroke="#192d4c" stroke-width="2"/><text x="${x(p)}" y="17" text-anchor="middle" fill="#a9b9d2" font-size="12">${esc(p.label)}</text></g>`).join(''):''}
      ${ticks.map(p => `<text x="${x(p)}" y="287" text-anchor="${p.step === 0 ? 'start' : p.step === maxStep ? 'end' : 'middle'}" fill="#c0c9da" font-size="15">${esc(p.label)}</text>${p.sub ? `<text x="${x(p)}" y="309" text-anchor="${p.step === 0 ? 'start' : p.step === maxStep ? 'end' : 'middle'}" fill="#8998b0" font-size="12">${esc(p.sub)}</text>` : ''}`).join('')}
      ${points.map((p, i) => {const a = i ? (x(points[i-1]) + x(p)) / 2 : L; const b = i < points.length-1 ? (x(p) + x(points[i+1])) / 2 : R;
        return `<g class="trend-sample"><circle cx="${x(p)}" cy="${y(p)}" r="3" fill="#afc8e3"/><rect tabindex="0" role="button" aria-label="${esc(description(p))}，蓝方 ${(p.blueWin*100).toFixed(1)}%" data-point="${i}" x="${a}" y="${T}" width="${Math.max(1,b-a)}" height="${B-T}" fill="transparent"><title>${esc(description(p))} · 蓝方 ${(p.blueWin*100).toFixed(1)}%</title></rect></g>`;}).join('')}
      </svg></div>${row('red', red, last ? 1-last.blueWin : undefined)}
      <div class="trend-detail" aria-live="polite"></div><p class="trend-footnote">${raw.length ? time ? esc(options.provenance || (options.historical ? '历史保存的阶段预测' : '按当前数据补算的阶段预测')) + ' · 分钟点由阶段预测插值，非实战采样' : '逐手 BP 模型预测' : empty} · 均势线为 50% · pp 为百分点 · 非实际比赛走势</p>
      <div class="finals-rail"><span class="finals-rail-line"></span><strong>天权kpl全局bp模拟系统</strong><span class="finals-rail-line"></span></div></div>`;
    const detail = container.querySelector('.trend-detail');
    const show = p => {detail.textContent = p ? `${description(p)}　蓝方 ${(p.blueWin*100).toFixed(1)}% / 红方 ${((1-p.blueWin)*100).toFixed(1)}%` : empty;};
    show(last);
    container.querySelectorAll('[data-point]').forEach(el => ['mouseenter', 'focus', 'click'].forEach(event => el.addEventListener(event, () => show(points[Number(el.dataset.point)]))));
    container.querySelector('.trend-plot').addEventListener('mouseleave', () => show(last));
  }};
})();
