// Lightweight interactive charts for Vectra artifacts; no remote runtime dependency.
(() => {
  const NS='http://www.w3.org/2000/svg',palette=['#60a5fa','#f59e0b','#34d399','#f472b6','#a78bfa','#fb7185','#22d3ee','#a3e635'];
  const svg=(name,attrs={})=>{const node=document.createElementNS(NS,name);for(const[key,value]of Object.entries(attrs))node.setAttribute(key,String(value));return node};
  window.renderVectraChart=(host,spec)=>{
    host.replaceChildren();const shell=document.createElement('div');shell.className='chart-shell';const heading=document.createElement('header');heading.className='chart-heading';const title=document.createElement('h2');title.textContent=spec.title||'Chart';heading.appendChild(title);if(spec.source){const source=document.createElement('span');source.textContent=`Source: ${spec.source}`;heading.appendChild(source)}const legend=document.createElement('div');legend.className='chart-legend';const canvas=document.createElement('div');canvas.className='chart-canvas';const tip=document.createElement('div');tip.className='chart-tooltip';shell.append(heading,legend,canvas,tip);host.appendChild(shell);
    const hidden=new Set(),series=spec.series||[],rows=spec.data||[];
    series.forEach((item,index)=>{const button=document.createElement('button');button.innerHTML=`<i style="background:${item.color||palette[index%palette.length]}"></i><span></span>`;button.querySelector('span').textContent=item.label||item.key;button.onclick=()=>{hidden.has(index)?hidden.delete(index):hidden.add(index);button.classList.toggle('off');draw()};legend.appendChild(button)});
    const draw=()=>{
      canvas.replaceChildren();const width=Math.max(1,canvas.clientWidth||760),height=Math.max(1,canvas.clientHeight||480),m={l:Math.min(64,width*.16),r:Math.min(24,width*.06),t:Math.min(24,height*.08),b:Math.min(58,height*.2)},w=Math.max(1,width-m.l-m.r),h=Math.max(1,height-m.t-m.b);
      const chart=svg('svg',{viewBox:`0 0 ${width} ${height}`,'aria-label':spec.title,role:'img'});canvas.appendChild(chart);
      const values=series.flatMap((item,index)=>hidden.has(index)?[]:rows.map(row=>Number(row[item.key])).filter(Number.isFinite));let lo=Math.min(0,...values),hi=Math.max(0,...values);if(lo===hi){lo-=1;hi+=1}const pad=(hi-lo)*.08;lo-=pad;hi+=pad;
      const rawX=rows.map((row,index)=>xValue(row[spec.xKey],index)),numeric=rawX.every(Number.isFinite),xmin=Math.min(...rawX),xmax=Math.max(...rawX),x=(i)=>m.l+(numeric&&xmax!==xmin?(rawX[i]-xmin)/(xmax-xmin):i/Math.max(1,rows.length-1))*w,y=(v)=>m.t+(hi-v)/(hi-lo)*h;
      for(let tick=0;tick<=5;tick++){const value=lo+(hi-lo)*tick/5,py=y(value);chart.appendChild(svg('line',{x1:m.l,x2:width-m.r,y1:py,y2:py,class:'chart-grid'}));label(chart,format(value),m.l-10,py+4,'end')}
      chart.append(svg('line',{x1:m.l,x2:m.l,y1:m.t,y2:height-m.b,class:'chart-axis'}),svg('line',{x1:m.l,x2:width-m.r,y1:height-m.b,y2:height-m.b,class:'chart-axis'}));
      const step=Math.max(1,Math.ceil(rows.length/7));rows.forEach((row,i)=>{if(i%step&&i!==rows.length-1)return;label(chart,String(row[spec.xKey]??''),x(i),height-m.b+22,'middle','chart-x-label')});
      series.forEach((item,index)=>{if(hidden.has(index))return;const color=item.color||palette[index%palette.length],points=rows.flatMap((row,i)=>{const value=Number(row[item.key]);return Number.isFinite(value)?[{i,value,px:x(i),py:y(value)}]:[]});
        if(spec.type==='bar'){const groupWidth=w/Math.max(1,rows.length),barWidth=Math.max(2,groupWidth*.72/series.length);points.forEach(point=>chart.appendChild(svg('rect',{x:point.px-groupWidth*.36+index*barWidth,y:Math.min(point.py,y(0)),width:barWidth-1,height:Math.abs(y(0)-point.py),fill:color,class:'chart-mark'})))}
        else{const d=points.map((point,i)=>`${i?'L':'M'}${point.px},${point.py}`).join(' ');if(spec.type==='area'&&points.length)chart.appendChild(svg('path',{d:`${d} L${points.at(-1).px},${y(0)} L${points[0].px},${y(0)} Z`,fill:color,opacity:.18}));if(spec.type!=='scatter')chart.appendChild(svg('path',{d,fill:'none',stroke:color,'stroke-width':2.5}));points.forEach(point=>{const dot=svg('circle',{cx:point.px,cy:point.py,r:spec.type==='scatter'?4.5:3,fill:color,class:'chart-mark'});dot.onmouseenter=(event)=>showTip(event,String(rows[point.i][spec.xKey]??''),item.label||item.key,format(point.value));dot.onmouseleave=hideTip;chart.appendChild(dot)})}
      });
      if(spec.xLabel)label(chart,spec.xLabel,m.l+w/2,height-8,'middle','chart-axis-label');if(spec.yLabel){const node=label(chart,spec.yLabel,16,m.t+h/2,'middle','chart-axis-label');node.setAttribute('transform',`rotate(-90 16 ${m.t+h/2})`)}
      function showTip(event,xText,name,value){tip.replaceChildren(document.createTextNode(xText),document.createElement('br'));const strong=document.createElement('strong');strong.textContent=`${name}: ${value}`;tip.appendChild(strong);tip.hidden=false;const rect=shell.getBoundingClientRect();tip.style.left=`${event.clientX-rect.left+10}px`;tip.style.top=`${event.clientY-rect.top-12}px`}function hideTip(){tip.hidden=true}
    };
    new ResizeObserver(draw).observe(canvas);draw();
  };
  function xValue(value,index){if(typeof value==='number')return value;const date=Date.parse(String(value));return Number.isFinite(date)?date:index}
  function format(value){return Math.abs(value)>=1e6?`${(value/1e6).toFixed(1)}M`:Math.abs(value)>=1e3?`${(value/1e3).toFixed(1)}K`:Number(value.toPrecision(5)).toLocaleString()}
  function label(parent,text,x,y,anchor='start',className='chart-label'){const node=svg('text',{x,y,'text-anchor':anchor,class:className});node.textContent=text;parent.appendChild(node);return node}
})();
