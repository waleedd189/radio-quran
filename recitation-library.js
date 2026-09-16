/* One audio element for the entire library. Original Archive URLs are never
   decoded, normalized, merged, or rewritten. Nothing auto-plays on page open. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const audio=$('recitationAudio');
  const library=document.body.dataset.library;
  const LAST_KEY='radioLibrary:'+library+':last';
  const PREF_KEY='radioLibrary:'+library+':prefs';
  const categories={long:'تلاوة مطوّلة',short:'مقطع قصير',adhan:'أذان وتكبيرات',dua:'دعاء'};
  const ar=n=>Number(n).toLocaleString('ar-EG');
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const rates=[.75,1,1.25,1.5];
  let tracks=[],byId=new Map(),filtered=[],rows=new Map(),queue=[];
  let selected=null,filter='all',wanted=false,attached=false,transitioning=false,mediaStarted=false;
  let ticket=0,pendingSeek=0,phase='idle',dragging=false,watchTimer=null,toastTimer=null,lastSavedAt=0;
  let lastNonzeroVolume=.7;
  let catalogRequest=null,storageWarningShown=false;
  const prefs=read(PREF_KEY,{});
  let volume=Number(prefs.volume),rate=Number(prefs.rate),repeat=prefs.repeat===true;
  volume=Number.isFinite(volume)?clamp(volume,0,1):.7;
  rate=rates.includes(rate)?rate:1;
  $('autoNext').checked=prefs.autoNext!==false;
  $('playbackRate').value=String(rate);$('volumeRange').value=Math.round(volume*100);

  function read(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')||fallback;}catch(e){return fallback;}}
  function write(key,value){
    try{localStorage.setItem(key,JSON.stringify(value));return true;}
    catch(e){
      if(!storageWarningShown){storageWarningShown=true;$('storageHint').textContent='تعذّر الحفظ المحلي في هذا المتصفح؛ يمكنك الاستماع بدون حفظ الموضع.';toast('تعذّر حفظ الإعدادات وموضع الاستماع. التشغيل متاح بدون حفظ.');}
      return false;
    }
  }
  function savePrefs(){write(PREF_KEY,{volume,rate,repeat,autoNext:$('autoNext').checked});}
  function toast(text){$('libraryToast').textContent=text;$('libraryToast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('libraryToast').classList.remove('show'),3500);}
  function normalize(text){return String(text).normalize('NFD').replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640\u200b-\u200f\ufffc]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).toLowerCase().replace(/\s+/g,' ').trim();}
  function formatTime(seconds){
    const total=Math.max(0,Math.floor(Number(seconds)||0)),hours=Math.floor(total/3600),minutes=Math.floor(total/60)%60;
    return (hours?hours+':'+String(minutes).padStart(2,'0'):String(minutes))+':'+String(total%60).padStart(2,'0');
  }
  function current(){return byId.get(selected)||null;}
  function hasSource(){return !!current() && attached && audio.getAttribute('src')===current().url;}
  function duration(){return hasSource() && Number.isFinite(audio.duration) && audio.duration>0?audio.duration:current()?.duration||0;}
  function time(){return hasSource() && (audio.currentTime>0 || audio.readyState>0)?audio.currentTime:pendingSeek;}
  function icon(button,name){button.querySelector('use')?.setAttribute('href','#ic-'+name);}
  function setPhase(next){
    phase=next;$('playerDock').dataset.state=phase;
    const labels={idle:'جاهز',ready:pendingSeek>0?'اضغط تشغيل للمتابعة من '+formatTime(pendingSeek):'اضغط تشغيل للاستماع',loading:'جارٍ الاتصال بالمصدر…',buffering:'جارٍ تحميل الصوت…',playing:'يُشغَّل الآن',paused:'متوقف مؤقتًا',ended:'انتهى التسجيل',error:'تعذّر تشغيل التسجيل'};
    $('playerStatus').textContent=labels[phase]||labels.idle;
    icon($('togglePlayback'),wanted?'pause':'play');
    $('togglePlayback').setAttribute('aria-label',wanted?'إيقاف مؤقت':'تشغيل');
    $('togglePlayback').setAttribute('aria-busy',['loading','buffering'].includes(phase)?'true':'false');
    paintRows();paintTransport();updateMediaSession(false);
  }
  function warning(message){$('playbackWarningText').textContent=message;$('playbackWarning').hidden=false;}
  function clearWarning(){$('playbackWarning').hidden=true;clearTimeout(watchTimer);watchTimer=null;}
  function watchLoading(){
    clearTimeout(watchTimer);
    const expected=ticket;
    watchTimer=setTimeout(()=>{if(expected===ticket && wanted && ['loading','buffering'].includes(phase))warning('التحميل يستغرق وقتًا. يمكنك إعادة المحاولة أو فتح الملف الأصلي.');},22000);
  }
  function error(){
    if(!hasSource()) return;
    saveProgress();wanted=false;clearTimeout(watchTimer);setPhase('error');
    warning(navigator.onLine===false?'لا يوجد اتصال بالإنترنت. أعد المحاولة عند عودة الشبكة.':'تعذّر تشغيل التسجيل من المصدر. أعد المحاولة، أو افتح الملف الأصلي من الزر بجوار العنوان.');
  }
  function saveProgress(reset=false){
    const track=current();if(!track)return;
    if(!mediaStarted && (!reset || read(LAST_KEY,{})?.id!==track.id))return;
    let position=reset?0:Math.max(0,time()||0);
    if(audio.ended || position>=duration()-1)position=0;
    write(LAST_KEY,{id:track.id,time:position,updatedAt:Date.now()});lastSavedAt=Date.now();
  }
  function paintNow(){
    const track=current();
    $('nowTitle').textContent=track?track.title:'اختر تسجيلًا لبدء الاستماع';
    $('nowTitle').title=track?track.sourceTitle:'';
    $('originalAudio').hidden=!track;
    if(track)$('originalAudio').href=track.url;
    const index=queue.indexOf(selected);
    $('queuePosition').textContent=track?'التسجيل '+ar(index>=0?index+1:track.number)+' من '+ar(queue.length||tracks.length):'مشغّل واحد لكل التسجيلات';
    paintProgress();paintTransport();paintRows();
  }
  function paintProgress(){
    const max=duration(),position=clamp(time()||0,0,max||0);
    if(!dragging){$('seekRange').max=max||1;$('seekRange').value=position;$('elapsedTime').textContent=formatTime(position);}
    $('durationTime').textContent=formatTime(Math.round(max));
    $('seekRange').disabled=!hasSource() || audio.readyState===0;
    $('seekRange').setAttribute('aria-valuetext',formatTime(position)+' من '+formatTime(Math.round(max)));
  }
  function paintTransport(){
    const index=queue.indexOf(selected);
    $('previousTrack').disabled=index<=0;
    $('nextTrack').disabled=index<0 || index>=queue.length-1;
    $('skipBack').disabled=$('skipForward').disabled=!hasSource() || audio.readyState===0;
    $('togglePlayback').disabled=!tracks.length || (!selected && !filtered.length);
    $('stopPlayback').disabled=!selected;
    $('playCollection').disabled=!filtered.length;
    $('repeatTrack').setAttribute('aria-pressed',String(repeat));
    icon($('toggleMute'),volume===0?'muted':'volume');
    $('toggleMute').setAttribute('aria-label',volume===0?'تشغيل الصوت':'كتم الصوت');
    $('toggleMute').title=volume===0?'تشغيل الصوت':'كتم الصوت';
  }
  function paintRows(){
    rows.forEach((el,id)=>{
      const active=id===selected;el.classList.toggle('is-selected',active);
      const button=el.querySelector('button');button.setAttribute('aria-pressed',String(active));
      const track=byId.get(id);
      button.setAttribute('aria-label',(active && wanted?'إيقاف مؤقت: ':'تشغيل: ')+track.title+'، التسجيل '+ar(track.number)+'، المدة '+formatTime(track.duration));
      el.querySelector('use')?.setAttribute('href',active && wanted?'#ic-pause':'#ic-play');
    });
  }
  function render(){
    const terms=normalize($('librarySearch').value).split(' ').filter(Boolean);
    filtered=tracks.filter(track=>(filter==='all'||track.category===filter) && terms.every(term=>track.search.includes(term)));
    $('resultCount').textContent=filtered.length===tracks.length?ar(tracks.length)+' تسجيلًا':ar(filtered.length)+' من '+ar(tracks.length)+' تسجيلًا';
    $('clearSearch').hidden=!$('librarySearch').value;
    $('emptyResults').hidden=filtered.length>0 || !tracks.length;
    $('trackList').replaceChildren();rows=new Map();
    const fragment=document.createDocumentFragment();
    filtered.forEach(track=>{
      const row=document.createElement('li');row.className='track-row';row.dataset.id=track.id;
      const button=document.createElement('button');button.type='button';button.className='track-main';button.title=track.sourceTitle;
      const number=document.createElement('span');number.className='track-number';number.textContent=ar(track.number);
      const copy=document.createElement('span');copy.className='track-copy';
      const title=document.createElement('strong');title.className='track-title';title.dir='auto';title.textContent=track.title;
      const meta=document.createElement('span');meta.className='track-meta';
      const kind=document.createElement('span');kind.textContent=categories[track.category];
      const code=document.createElement('span');code.className='source-code';code.textContent='ملف '+track.sourceCode;
      meta.append(kind,code);copy.append(title,meta);
      const clock=document.createElement('span');clock.className='track-duration';clock.dir='ltr';clock.textContent=formatTime(track.duration);
      const play=document.createElement('span');play.className='row-play';play.setAttribute('aria-hidden','true');
      play.innerHTML='<svg><use href="#ic-play"></use></svg>';
      button.append(number,copy,clock,play);button.addEventListener('click',()=>{
        if(selected===track.id)toggle();else startTrack(track.id,{queue:filtered.map(t=>t.id)});
      });
      row.appendChild(button);fragment.appendChild(row);rows.set(track.id,row);
    });
    $('trackList').appendChild(fragment);paintRows();paintTransport();
    document.querySelectorAll('[data-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.filter===filter)));
  }
  function selectWithoutPlaying(id,position=0){
    if(!byId.has(id))return;
    selected=id;mediaStarted=false;queue=tracks.map(t=>t.id);pendingSeek=clamp(position,0,Math.max(0,current().duration-1));
    if(pendingSeek>=current().duration-2)pendingSeek=0;
    wanted=false;setPhase('ready');paintNow();
  }
  function startTrack(id,options={}){
    const track=byId.get(id);if(!track)return;
    if(navigator.onLine===false){warning('لا يوجد اتصال بالإنترنت. البث الصوتي يحتاج اتصالًا بالشبكة.');return;}
    saveProgress();ticket++;const expected=ticket;clearWarning();transitioning=true;
    audio.pause();audio.removeAttribute('src');audio.load();attached=false;
    selected=id;mediaStarted=false;pendingSeek=clamp(Number(options.seek)||0,0,Math.max(0,track.duration-1));
    queue=options.queue?.length?options.queue.slice():queue.includes(id)?queue:tracks.map(t=>t.id);
    wanted=true;audio.src=track.url;attached=true;audio.volume=volume;audio.muted=volume===0;audio.playbackRate=rate;
    setPhase('loading');paintNow();updateMediaSession(true);watchLoading();
    audio.load();
    audio.play().then(()=>{if(expected===ticket && wanted)paintProgress();}).catch(e=>{
      if(expected!==ticket || !wanted || e.name==='AbortError')return;
      if(e.name==='NotAllowedError'){wanted=false;clearWarning();setPhase('paused');toast('اضغط تشغيل للسماح بتشغيل الصوت في المتصفح.');}
      else error();
    });
  }
  function pause(){
    if(!current())return;
    wanted=false;ticket++;clearWarning();audio.pause();saveProgress();setPhase('paused');
  }
  function toggle(){
    if(!tracks.length)return;
    if(wanted || (hasSource()&&!audio.paused)){pause();return;}
    if(!current()){
      const first=filtered[0];if(first)startTrack(first.id,{queue:filtered.map(t=>t.id)});return;
    }
    if(!hasSource() || phase==='error' || audio.error){startTrack(selected,{seek:time()});return;}
    if(audio.ended || audio.currentTime>=duration()-1){try{audio.currentTime=0;}catch(e){}}
    wanted=true;clearWarning();setPhase('loading');
    const expected=++ticket;updateMediaSession(true);watchLoading();
    audio.play().catch(e=>{if(expected!==ticket || !wanted || e.name==='AbortError')return;if(e.name==='NotAllowedError'){wanted=false;clearWarning();setPhase('paused');}else error();});
  }
  function move(delta){
    const index=queue.indexOf(selected),next=index+delta;
    if(index<0 || next<0 || next>=queue.length)return;
    startTrack(queue[next],{queue});
  }
  function seek(value){
    if(!hasSource() || !Number.isFinite(Number(value)) || audio.readyState===0)return;
    try{audio.currentTime=clamp(Number(value),0,Math.max(0,duration()-.05));pendingSeek=0;paintProgress();saveProgress();updateMediaSession(false);}catch(e){}
  }
  function stop(){
    if(!current())return;
    ticket++;wanted=false;clearWarning();transitioning=true;
    audio.pause();attached=false;audio.removeAttribute('src');audio.load();pendingSeek=0;
    saveProgress(true);mediaStarted=false;setPhase('ready');paintNow();
    if('mediaSession'in navigator)try{navigator.mediaSession.playbackState='none';}catch(e){}
  }
  function release(){
    if(!current())return;
    const position=time();saveProgress();ticket++;wanted=false;clearWarning();transitioning=true;
    audio.pause();attached=false;audio.removeAttribute('src');audio.load();pendingSeek=position;
    mediaStarted=false;setPhase('ready');paintNow();
    if('mediaSession'in navigator)try{navigator.mediaSession.playbackState='none';}catch(e){}
  }
  function updateMediaSession(metadata){
    if(!('mediaSession'in navigator) || !hasSource() || !current())return;
    try{
      if(metadata)navigator.mediaSession.metadata=new MediaMetadata({title:current().title,artist:'محمد أيوب عاصف',album:'راديو قرآن — مكتبة التلاوات',artwork:[{src:new URL('assets/ayyub-asif.webp',location.href).href,sizes:'768x432',type:'image/webp'}]});
      navigator.mediaSession.playbackState=phase==='playing'?'playing':'paused';
      const d=duration();if(d>0 && Number.isFinite(d) && navigator.mediaSession.setPositionState)navigator.mediaSession.setPositionState({duration:d,playbackRate:rate,position:clamp(time()||0,0,d)});
    }catch(e){}
  }
  function setVolume(value){
    volume=clamp(Number(value)||0,0,1);if(volume>0)lastNonzeroVolume=volume;
    audio.volume=volume;audio.muted=volume===0;$('volumeRange').value=Math.round(volume*100);savePrefs();paintTransport();
  }
  async function share(){
    const url=new URL(document.querySelector('link[rel="canonical"]')?.href||location.href);url.search='';url.hash=selected||'';
    const payload={title:'تلاوات الشيخ محمد أيوب عاصف',text:current()?.title||'مكتبة تلاوات الشيخ محمد أيوب عاصف — راديو قرآن',url:url.href};
    try{if(navigator.share){await navigator.share(payload);return;}if(navigator.clipboard){await navigator.clipboard.writeText(url.href);toast('تم نسخ رابط '+(current()?'التسجيل.':'الصفحة.'));return;}}catch(e){if(e.name==='AbortError')return;}
    toast('يمكنك مشاركة رابط الصفحة من شريط عنوان المتصفح.');
  }
  async function loadCatalog(){
    if(catalogRequest)return catalogRequest;
    $('catalogError').hidden=true;$('catalogLoading').hidden=false;
    catalogRequest=(async()=>{
      try{
        const response=await fetch(document.body.dataset.catalog);
        if(!response.ok)throw new Error('Catalog unavailable');
        const data=await response.json();
        if(!Array.isArray(data.tracks)||!data.tracks.length)throw new Error('Invalid catalog');
        const ids=new Set();
        const valid=data.tracks.map(track=>{
          const url=new URL(track.url);
          if(!/^track-\d{3}$/.test(track.id)||ids.has(track.id)||url.protocol!=='https:'||url.hostname!=='archive.org'||!url.pathname.startsWith('/download/a-33aaaaaaaaaaass/')||!Number.isFinite(track.duration)||track.duration<=0||!categories[track.category]||typeof track.title!=='string'||typeof track.sourceTitle!=='string')throw new Error('Invalid track');
          ids.add(track.id);
          return Object.freeze({...track,search:normalize(track.title+' '+track.sourceTitle+' '+track.sourceCode+' '+track.number+' '+categories[track.category])});
        });
        tracks=valid;byId=new Map(tracks.map(track=>[track.id,track]));
        const seconds=tracks.reduce((sum,t)=>sum+t.duration,0);
        $('totalTracks').textContent=ar(tracks.length);$('totalLength').textContent=ar(Math.floor(seconds/3600))+' ساعة و'+ar(Math.floor(seconds/60)%60)+' دقيقة';
        document.querySelectorAll('[data-count]').forEach(el=>el.textContent=ar(el.dataset.count==='all'?tracks.length:tracks.filter(t=>t.category===el.dataset.count).length));
        $('librarySearch').disabled=false;$('catalogLoading').hidden=true;
        const last=read(LAST_KEY,null),hash=location.hash.slice(1);
        if(byId.has(hash))selectWithoutPlaying(hash);
        else if(last && byId.has(last.id) && Number.isFinite(last.time) && last.time>=0)selectWithoutPlaying(last.id,last.time);
        render();paintTransport();
      }catch(e){$('catalogLoading').hidden=true;$('catalogError').hidden=false;}
      finally{catalogRequest=null;}
    })();
    return catalogRequest;
  }

  $('playCollection').addEventListener('click',()=>{if(filtered.length)startTrack(filtered[0].id,{queue:filtered.map(t=>t.id)});});
  $('togglePlayback').addEventListener('click',toggle);$('previousTrack').addEventListener('click',()=>move(-1));$('nextTrack').addEventListener('click',()=>move(1));
  $('skipBack').addEventListener('click',()=>seek(time()-10));$('skipForward').addEventListener('click',()=>seek(time()+10));$('stopPlayback').addEventListener('click',stop);
  $('seekRange').addEventListener('input',()=>{dragging=true;$('elapsedTime').textContent=formatTime($('seekRange').value);});
  $('seekRange').addEventListener('change',()=>{dragging=false;seek($('seekRange').value);});
  $('seekRange').addEventListener('pointercancel',()=>{dragging=false;paintProgress();});
  $('volumeRange').addEventListener('input',()=>setVolume(Number($('volumeRange').value)/100));
  $('toggleMute').addEventListener('click',()=>setVolume(volume===0?lastNonzeroVolume:0));
  $('playbackRate').addEventListener('change',()=>{rate=Number($('playbackRate').value);if(!rates.includes(rate))rate=1;audio.playbackRate=rate;savePrefs();updateMediaSession(false);});
  $('autoNext').addEventListener('change',savePrefs);$('repeatTrack').addEventListener('click',()=>{repeat=!repeat;savePrefs();paintTransport();});
  $('shareLibrary').addEventListener('click',share);$('originalAudio').addEventListener('click',pause);
  $('retryCatalog').addEventListener('click',loadCatalog);$('retryPlayback').addEventListener('click',()=>{if(current())startTrack(selected,{seek:time(),queue});});
  $('librarySearch').addEventListener('input',render);
  $('clearSearch').addEventListener('click',()=>{$('librarySearch').value='';render();$('librarySearch').focus({preventScroll:true});});
  $('resetFilters').addEventListener('click',()=>{filter='all';$('librarySearch').value='';render();});
  document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{filter=button.dataset.filter;render();}));

  audio.addEventListener('loadstart',()=>{transitioning=false;if(hasSource()&&wanted){setPhase('loading');watchLoading();}});
  audio.addEventListener('loadedmetadata',()=>{
    if(!hasSource())return;
    if(pendingSeek>0){try{audio.currentTime=clamp(pendingSeek,0,Math.max(0,duration()-1));}catch(e){}pendingSeek=0;}
    paintProgress();paintTransport();updateMediaSession(false);
  });
  audio.addEventListener('playing',()=>{if(!hasSource()||audio.paused)return;mediaStarted=true;wanted=true;clearWarning();setPhase('playing');paintProgress();updateMediaSession(true);saveProgress();});
  audio.addEventListener('waiting',()=>{if(hasSource()&&wanted){setPhase('buffering');watchLoading();}});
  audio.addEventListener('stalled',()=>{if(hasSource()&&wanted&&audio.readyState<3){setPhase('buffering');watchLoading();}});
  audio.addEventListener('pause',()=>{if(transitioning||!hasSource()||!audio.paused||audio.error||phase==='error')return;wanted=false;clearWarning();setPhase(audio.ended?'ended':'paused');saveProgress();});
  audio.addEventListener('timeupdate',()=>{if(!hasSource())return;paintProgress();updateMediaSession(false);if(Date.now()-lastSavedAt>4000)saveProgress();});
  audio.addEventListener('durationchange',()=>{if(hasSource())paintProgress();});
  audio.addEventListener('error',()=>{if(audio.error && hasSource())error();});
  audio.addEventListener('ended',()=>{
    if(!hasSource())return;wanted=false;saveProgress(true);pendingSeek=0;
    if(repeat){seek(0);toggle();return;}
    const index=queue.indexOf(selected);
    if($('autoNext').checked && index>=0 && index<queue.length-1){move(1);return;}
    clearWarning();setPhase('ended');paintProgress();
  });
  window.addEventListener('pagehide',release);
  window.addEventListener('offline',()=>{if(wanted)warning('انقطع الاتصال. قد يستمر الصوت المحمّل مؤقتًا؛ أعد المحاولة إذا توقف.');});
  window.addEventListener('online',()=>{if(phase==='error')warning('عاد الاتصال بالإنترنت. اضغط إعادة المحاولة لاستئناف التسجيل.');else if(wanted)clearWarning();});
  window.addEventListener('hashchange',()=>{const id=location.hash.slice(1);if(byId.has(id)&&id!==selected){release();selectWithoutPlaying(id);}});
  document.addEventListener('keydown',event=>{
    if(event.code==='Space'&&!event.target.closest('button,input,select,a,textarea')&&!event.target.isContentEditable){event.preventDefault();toggle();}
  });
  if('mediaSession'in navigator){
    const actions={play:()=>{if(!wanted)toggle();},pause,stop,previoustrack:()=>move(-1),nexttrack:()=>move(1),seekbackward:details=>seek(time()-(details.seekOffset||10)),seekforward:details=>seek(time()+(details.seekOffset||10)),seekto:details=>seek(details.seekTime)};
    Object.entries(actions).forEach(([action,handler])=>{try{navigator.mediaSession.setActionHandler(action,handler);}catch(e){}});
  }
  function dockSize(){document.documentElement.style.setProperty('--dock-height',Math.ceil($('playerDock').getBoundingClientRect().height)+'px');}
  if('ResizeObserver'in window)new ResizeObserver(dockSize).observe($('playerDock'));
  window.addEventListener('resize',dockSize);dockSize();paintTransport();loadCatalog();
  if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
})();
