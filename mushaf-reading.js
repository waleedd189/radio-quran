/* Local reading position, five explicit bookmarks, and the native Screen Wake
   Lock API. No account, analytics, hidden video, or extra audio player. */
(function(){
  'use strict';
  const LAST_KEY='mushafLastPositionV1';
  const BOOKMARKS_KEY='mushafBookmarksV1';
  const LIMIT=5, TOTAL_PAGES=604;
  const $=id=>document.getElementById(id);
  const ar=n=>Number(n).toLocaleString('ar-EG');
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  let bookmarks=[],readyPage=null,restoring=false,pendingRestore=null;
  let navigation=0,saveTimer=null,noticeTimer=null,flashTimer=null;
  let fingerprint='',pendingDelete=null,started=false,active=true;
  let autoState='pending';
  let readingPoint=null,geometryStamp='',lastScrollTop=null,layoutPending=false;

  function currentPage(){return typeof cur==='number'?cur:1;}
  function currentFolio(){return document.querySelector('.folio[data-p="'+currentPage()+'"]');}
  function validPosition(value){
    if(typeof value==='number') value={page:value};
    if(!value || typeof value!=='object') return null;
    const page=Number(value.page);
    if(!Number.isInteger(page) || page<1 || page>TOTAL_PAGES) return null;
    const line=clamp(Math.round(Number(value.line)||1),1,page<=2?8:15);
    const offset=Number(value.offset),ratio=Number(value.ratio);
    return {
      v:1,page,line,
      offset:Number.isFinite(offset)?clamp(offset,-2,2):0,
      ratio:Number.isFinite(ratio)?clamp(ratio,0,1):0,
      atTop:value.atTop===true || (value.atTop==null && line===1 && !(ratio>0)),
      names:typeof value.names==='string'?value.names.slice(0,150):'',
      savedAt:Number.isFinite(Number(value.savedAt))?Number(value.savedAt):0
    };
  }
  function readJSON(key,fallback){
    try{
      const raw=localStorage.getItem(key);
      if(raw===null) return fallback;
      try{return JSON.parse(raw);}catch(e){return fallback;}
    }catch(e){setAutoState('blocked');return fallback;}
  }
  function writeJSON(key,value){
    try{localStorage.setItem(key,JSON.stringify(value));return true;}
    catch(e){setAutoState('blocked');return false;}
  }
  function cleanBookmarks(value){
    if(!Array.isArray(value)) return [];
    const result=[],places=new Set(),ids=new Set();
    for(const raw of value){
      const pos=validPosition(raw);
      if(!pos) continue;
      const place=pos.page+':'+pos.line;
      const id=typeof raw.id==='string' && /^[a-zA-Z0-9_-]{1,80}$/.test(raw.id)
        ?raw.id:'saved-'+pos.page+'-'+pos.line;
      if(places.has(place) || ids.has(id)) continue;
      result.push({...pos,id});places.add(place);ids.add(id);
      if(result.length===LIMIT) break;
    }
    return result;
  }
  function readBookmarks(){return cleanBookmarks(readJSON(BOOKMARKS_KEY,[]));}
  function notice(message){
    const el=$('mushafNotice');
    el.textContent=message;el.classList.add('show');
    clearTimeout(noticeTimer);
    noticeTimer=setTimeout(()=>el.classList.remove('show'),4200);
  }
  function setAutoState(state){
    autoState=state;
    const el=$('readingSaveStatus');
    if(!el) return;
    const labels={pending:'حفظ الموضع تلقائيًا',saved:'موضعك محفوظ',restored:'استُعيد موضعك',blocked:'الحفظ غير متاح'};
    el.textContent=labels[state]||labels.pending;
    el.dataset.state=state;
    el.title=state==='blocked'
      ?'تعذّر الحفظ في هذا المتصفح. اسمح بتخزين بيانات الموقع؛ قد لا يبقى الموضع بعد إغلاقه.'
      :'آخر موضع محفوظ محليًا على هذا الجهاز والمتصفح، مستقلًا عن علامات الحفظ الخمس.';
  }
  function geometry(fol){
    return [fol.clientWidth,fol.clientHeight,typeof fs==='number'?fs:1].join(':');
  }
  function withCurrentMetadata(pos){
    if(!pos) return null;
    const data=typeof pageCache==='object'?pageCache[pos.page]:null;
    const names=(data?.surahs||[]).map(s=>s.name_arabic).join('، ').slice(0,150);
    return {...pos,names:names||pos.names||'',savedAt:Date.now()};
  }
  function captureGeometry(fol){
    if(!fol || fol.dataset.fitted!=='1' || Number(fol.dataset.p)!==currentPage()) return null;
    const rect=fol.getBoundingClientRect();
    const lines=[...fol.querySelectorAll('.mline')];
    if(!lines.length) return null;
    const atTop=fol.scrollTop<=1;
    const anchor=atTop?lines[0]:lines.find(line=>line.getBoundingClientRect().bottom>rect.top+1)||lines[lines.length-1];
    const box=anchor.getBoundingClientRect();
    return withCurrentMetadata({
      v:1,page:currentPage(),line:Number(anchor.dataset.line),
      offset:atTop?0:+clamp((rect.top-box.top)/Math.max(1,box.height),-2,2).toFixed(5),
      ratio:atTop?0:+(fol.scrollTop/Math.max(1,fol.scrollHeight-fol.clientHeight)).toFixed(5),
      atTop
    });
  }
  function rememberPoint(pos,fol){
    readingPoint=pos?{...pos}:null;
    geometryStamp=fol?geometry(fol):'';
    lastScrollTop=fol?fol.scrollTop:null;
  }
  function capture(){
    const fol=currentFolio();
    if(!active || restoring || readyPage!==currentPage() || !fol || fol.dataset.fitted!=='1') return null;
    // Keep the actual reading LINE, not the first visible line after a resize.
    // When the entire page fits, the browser necessarily clamps scrollTop to 0.
    const changedByScroll=!layoutPending && geometry(fol)===geometryStamp &&
      fol.scrollHeight-fol.clientHeight>1 && lastScrollTop!==null && Math.abs(fol.scrollTop-lastScrollTop)>.5;
    if(!readingPoint || readingPoint.page!==currentPage() || changedByScroll){
      rememberPoint(captureGeometry(fol),fol);
    }
    return withCurrentMetadata(readingPoint);
  }
  function persistLast(pos){
    if(!pos) return false;
    const key=JSON.stringify([pos.page,pos.line,pos.offset,pos.ratio,pos.atTop,pos.names]);
    if(key===fingerprint && autoState!=='blocked') return true;
    if(!writeJSON(LAST_KEY,pos)) return false;
    fingerprint=key;setAutoState('saved');return true;
  }
  function flush(){
    clearTimeout(saveTimer);saveTimer=null;
    let pos=capture();
    // A valid new folio may have appeared just before pagehide/Home, while the
    // two-frame restore callback is still queued. Do not lose that last page.
    // Failed/loading pages have no data-fitted flag and never overwrite progress.
    if(!pos && active && restoring){
      const fol=currentFolio();
      if(fol?.dataset.fitted==='1'){
        pos=pendingRestore?.pos.page===currentPage()
          ?withCurrentMetadata(pendingRestore.pos):captureGeometry(fol);
      }
    }
    return persistLast(pos);
  }
  function scheduleSave(){
    clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>{saveTimer=null;persistLast(capture());updateButton();},160);
  }
  function restorePosition(pos,fol){
    if(!pos || !fol || Number(fol.dataset.p)!==pos.page) return;
    if(pos.atTop){fol.scrollTop=0;return;}
    const line=[...fol.querySelectorAll('.mline')].find(el=>Number(el.dataset.line)===pos.line);
    const max=Math.max(0,fol.scrollHeight-fol.clientHeight);
    if(line){
      const y=line.getBoundingClientRect().top-fol.getBoundingClientRect().top+fol.scrollTop;
      fol.scrollTop=clamp(y+pos.offset*line.getBoundingClientRect().height,0,max);
    }else fol.scrollTop=max*pos.ratio;
  }
  function flashPosition(pos,fol){
    if(!pos || pos.line<=1) return;
    clearTimeout(flashTimer);
    document.querySelectorAll('.mline.is-reading-target').forEach(el=>el.classList.remove('is-reading-target'));
    const line=[...fol.querySelectorAll('.mline')].find(el=>Number(el.dataset.line)===pos.line);
    if(line){line.classList.add('is-reading-target');flashTimer=setTimeout(()=>line.classList.remove('is-reading-target'),2200);}
  }
  function beforeShow(page,options){
    const retryTarget=restoring && pendingRestore?.pos.page===page?pendingRestore:null;
    flush();navigation++;readyPage=null;restoring=true;
    readingPoint=null;geometryStamp='';lastScrollTop=null;layoutPending=false;
    const pos=validPosition(options?.restore);
    pendingRestore=pos?.page===page?{pos,reason:options.reason||'bookmark'}:retryTarget;
    updateButton();
    if($('bookmarksOv').classList.contains('show')) renderBookmarks();
  }
  function onPageReady(fol){
    if(Number(fol.dataset.p)!==currentPage()) return;
    const ticket=navigation;
    // Layout/loaded glyphs must settle before the saved line/scroll offset is used.
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(ticket!==navigation || !active || !fol.isConnected || Number(fol.dataset.p)!==currentPage()) return;
      // BFCache can replay a queued callback alongside pageshow's recovery.
      // Apply the saved target only once for this navigation.
      if(!restoring && readyPage===currentPage()) return;
      const target=pendingRestore;pendingRestore=null;
      if(target){restorePosition(target.pos,fol);flashPosition(target.pos,fol);}
      readyPage=currentPage();restoring=false;
      rememberPoint(target?withCurrentMetadata(target.pos):captureGeometry(fol),fol);
      if(document.visibilityState==='visible'){
        const ok=flush();
        if(ok && target?.reason==='initial') setAutoState('restored');
      }
      updateButton();
      if($('bookmarksOv').classList.contains('show')) renderBookmarks();
    }));
  }
  function beforeLayout(){
    const pos=capture();
    layoutPending=true;
    return pos;
  }
  function afterLayout(pos){
    if(pos && !restoring && pos.page===currentPage()){
      const fol=currentFolio();
      restorePosition(pos,fol);
      // Remember the applied scrollTop as well, so its native scroll event is
      // not mistaken for a user choosing a different reading line.
      rememberPoint(pos,fol);
    }
    layoutPending=false;
    if(pos && !restoring) scheduleSave();
  }

  function samePlace(a,b){return !!a && !!b && a.page===b.page && a.line===b.line;}
  function updateButton(){
    const button=$('bookmarkButton');
    $('bookmarkCount').textContent=ar(bookmarks.length)+' / '+ar(LIMIT);
    button.setAttribute('aria-label','علامات الحفظ، '+ar(bookmarks.length)+' من '+ar(LIMIT));
    const here=bookmarks.some(mark=>mark.page===currentPage());
    button.classList.toggle('has-bookmark',here);
    $('bookmarkButtonIcon').className=(here?'fas':'far')+' fa-bookmark';
  }
  function description(pos){return 'صفحة '+ar(pos.page)+(pos.line>1?' • السطر '+ar(pos.line):'');}
  function makeButton(label,className,onClick){
    const button=document.createElement('button');button.type='button';
    button.className=className;button.textContent=label;button.addEventListener('click',onClick);return button;
  }
  function renderBookmarks(){
    const list=$('bookmarkList');list.replaceChildren();
    const pos=capture(),duplicate=bookmarks.some(mark=>samePlace(mark,pos));
    $('bookmarkTotal').textContent=ar(bookmarks.length)+' / '+ar(LIMIT);
    const save=$('saveBookmarkButton');
    save.disabled=!pos || duplicate || bookmarks.length>=LIMIT;
    $('saveBookmarkLabel').textContent=duplicate?'هذا المكان محفوظ بالفعل':'حفظ مكاني الحالي';
    $('bookmarkCurrent').textContent=pos?description(pos)+(pos.names?' • '+pos.names:''):'انتظر اكتمال تحميل الصفحة لحفظ موضعها.';
    $('bookmarkLimit').textContent=bookmarks.length>=LIMIT
      ?'وصلت إلى ٥ علامات. احذف علامة إن أردت إضافة مكان جديد؛ لن تُستبدل أي علامة تلقائيًا.'
      :'اضغط على أي علامة للعودة إليها. آخر موضع قراءة يُحفظ تلقائيًا خارج هذه العلامات الخمس.';
    if(!bookmarks.length){
      const empty=document.createElement('li');empty.className='bookmark-empty';
      empty.textContent='لا توجد علامات بعد. احفظ مكانك الحالي لتعود إليه بسهولة.';list.appendChild(empty);
    }
    bookmarks.forEach((mark,index)=>{
      const item=document.createElement('li');item.className='bookmark-item';item.dataset.id=mark.id;
      const go=document.createElement('button');go.type='button';go.className='bookmark-go';
      go.setAttribute('aria-label','العودة إلى '+description(mark)+(mark.names?'، '+mark.names:''));
      const number=document.createElement('span');number.className='bookmark-number';number.textContent=ar(index+1);
      const copy=document.createElement('span');copy.className='bookmark-copy';
      const name=document.createElement('strong');name.textContent=mark.names||'علامة قراءة';
      const place=document.createElement('small');place.textContent=description(mark);copy.append(name,place);go.append(number,copy);
      go.addEventListener('click',()=>goToBookmark(mark.id));
      const remove=makeButton('×','bookmark-delete',()=>{pendingDelete=mark.id;renderBookmarks();list.querySelector('[data-confirm-delete]')?.focus();});
      remove.setAttribute('aria-label','حذف علامة '+description(mark));remove.title='حذف العلامة';
      item.append(go,remove);
      if(pendingDelete===mark.id){
        const confirm=document.createElement('div');confirm.className='bookmark-confirm';
        const text=document.createElement('span');text.textContent='حذف هذه العلامة؟';
        const yes=makeButton('حذف','bookmark-confirm-yes',()=>deleteBookmark(mark.id));yes.dataset.confirmDelete='';
        const no=makeButton('إلغاء','bookmark-confirm-no',()=>{pendingDelete=null;renderBookmarks();});
        confirm.append(text,yes,no);item.appendChild(confirm);
      }
      list.appendChild(item);
    });
    updateButton();
  }
  function openBookmarks(){
    window.closeFont?.();window.closeSurahs?.();
    bookmarks=readBookmarks();pendingDelete=null;renderBookmarks();
    $('bookmarksOv').classList.add('show');$('bookmarkButton').setAttribute('aria-expanded','true');
    ($('saveBookmarkButton').disabled?$('bookmarksClose'):$('saveBookmarkButton')).focus({preventScroll:true});
  }
  function closeBookmarks(){
    if(!$('bookmarksOv').classList.contains('show')) return;
    $('bookmarksOv').classList.remove('show');$('bookmarkButton').setAttribute('aria-expanded','false');
    pendingDelete=null;$('bookmarkButton').focus({preventScroll:true});
  }
  function addBookmark(){
    const pos=capture();
    if(!pos){notice('انتظر تحميل الصفحة أولًا.');return false;}
    bookmarks=readBookmarks();
    if(bookmarks.some(mark=>samePlace(mark,pos))){renderBookmarks();notice('هذا المكان محفوظ بالفعل.');return false;}
    if(bookmarks.length>=LIMIT){renderBookmarks();notice('لديك ٥ علامات بالفعل. احذف واحدة لإضافة مكان جديد.');return false;}
    const id=globalThis.crypto?.randomUUID?.()||'mark-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);
    const next=[...bookmarks,{...pos,id}];
    if(!writeJSON(BOOKMARKS_KEY,next)){notice('تعذّر حفظ العلامة. اسمح للمتصفح بتخزين بيانات الموقع.');return false;}
    bookmarks=next;renderBookmarks();notice('تم حفظ مكانك • '+description(pos));
    $('bookmarkList').lastElementChild?.querySelector('.bookmark-go')?.focus({preventScroll:true});
    return true;
  }
  function deleteBookmark(id){
    bookmarks=readBookmarks();
    const next=bookmarks.filter(mark=>mark.id!==id);
    if(next.length===bookmarks.length) return;
    if(!writeJSON(BOOKMARKS_KEY,next)){notice('تعذّر حذف العلامة من التخزين. حاول مرة أخرى.');return;}
    bookmarks=next;pendingDelete=null;renderBookmarks();notice('تم حذف العلامة.');
    ($('saveBookmarkButton').disabled?$('bookmarksClose'):$('saveBookmarkButton')).focus({preventScroll:true});
  }
  function goToBookmark(id){
    const mark=bookmarks.find(item=>item.id===id);if(!mark) return;
    closeBookmarks();window.show(mark.page,{restore:mark,reason:'bookmark'});
  }

  /* A wake lock is held only while this document is visible. Browsers/OSs can
     refuse or release it (e.g. battery saver); reflect the real lease state. */
  let wakeLease=null,wakePending=null,wakeEpoch=0,wakeTimer=null;
  let wakeRecoveries=0,lastWakeAttempt=0,gestureRetried=false,wakePermission='unknown';
  function wakeSupported(){return !!navigator.wakeLock && typeof navigator.wakeLock.request==='function' && window.isSecureContext;}
  function wakeState(state){
    const button=$('readerWakeButton');button.dataset.wakeState=state;
    const states={
      active:['الشاشة مضيئة','إبقاء الشاشة مضيئة مفعّل ما دام المصحف ظاهرًا. يظل زر القفل اليدوي وإعدادات النظام تحت تحكمك.'],
      requesting:['جارٍ تفعيل الشاشة…','جارٍ طلب إبقاء الشاشة مضيئة من المتصفح.'],
      paused:['الشاشة: في الانتظار','يُعاد طلب إبقاء الشاشة مضيئة عند الرجوع إلى المصحف.'],
      released:['إعادة تثبيت الشاشة…','حرّر النظام قفل الشاشة؛ نحاول تفعيله مرة أخرى.'],
      denied:['اضغط لإضاءة الشاشة','لم يسمح المتصفح أو النظام بإبقاء الشاشة مضيئة. اضغط لإعادة المحاولة؛ وقد تحتاج لإلغاء وضع توفير الطاقة.'],
      unsupported:['الشاشة: غير مدعوم','هذا المتصفح لا يدعم إبقاء الشاشة مضيئة. جرّب متصفحًا حديثًا أو زِد مهلة إطفاء الشاشة من إعدادات الجهاز.']
    };
    const [label,help]=states[state]||states.denied;
    $('readerWakeText').textContent=label;button.title=help;button.setAttribute('aria-label',help);
    button.setAttribute('aria-busy',state==='requesting'?'true':'false');
  }
  function releaseWakeLock(){
    wakeEpoch++;clearTimeout(wakeTimer);wakeTimer=null;wakePending=null;
    const lease=wakeLease;wakeLease=null;
    if(lease && !lease.released) Promise.resolve(lease.release()).catch(()=>{});
    wakeState('paused');
  }
  function ensureWakeLock(){
    if(!active || document.visibilityState!=='visible') return Promise.resolve(false);
    if(!wakeSupported()){wakeState('unsupported');return Promise.resolve(false);}
    if(wakeLease && !wakeLease.released){wakeState('active');return Promise.resolve(true);}
    if(wakePending) return wakePending;
    const ticket=wakeEpoch;lastWakeAttempt=Date.now();wakeState('requesting');
    const request=(async()=>{
      try{
        const lease=await navigator.wakeLock.request('screen');
        if(ticket!==wakeEpoch || !active || document.visibilityState!=='visible'){
          await lease.release().catch(()=>{});return false;
        }
        if(lease.released){wakeState('denied');return false;}
        wakeLease=lease;const heldSince=Date.now();
        lease.addEventListener('release',()=>{
          if(wakeLease!==lease) return;
          wakeLease=null;
          if(!active || document.visibilityState!=='visible'){wakeState('paused');return;}
          if(Date.now()-heldSince>30000) wakeRecoveries=0;
          if(wakeRecoveries>=2){wakeState('denied');return;}
          wakeRecoveries++;wakeState('released');
          clearTimeout(wakeTimer);wakeTimer=setTimeout(()=>{wakeTimer=null;ensureWakeLock();},700*wakeRecoveries);
        });
        wakeState('active');return true;
      }catch(e){
        if(ticket===wakeEpoch && active && document.visibilityState==='visible') wakeState('denied');
        return false;
      }
    })();
    wakePending=request;
    request.finally(()=>{if(wakePending===request) wakePending=null;});
    return request;
  }
  function retryWakeLock(){
    if(!wakeSupported()){wakeState('unsupported');notice($('readerWakeButton').title);return;}
    wakeRecoveries=0;gestureRetried=false;clearTimeout(wakeTimer);wakeTimer=null;
    ensureWakeLock().then(ok=>notice(ok?'الشاشة ستبقى مضيئة أثناء عرض المصحف.':$('readerWakeButton').title));
  }

  function start(){
    if(started) return validPosition(readJSON(LAST_KEY,null))||{page:1,atTop:true,line:1};
    started=true;active=true;
    const saved=validPosition(readJSON(LAST_KEY,null));
    bookmarks=readBookmarks();updateButton();
    $('bookmarkButton').disabled=false;$('readerWakeButton').disabled=false;
    $('bookmarkButton').addEventListener('click',openBookmarks);
    $('bookmarksClose').addEventListener('click',closeBookmarks);
    $('saveBookmarkButton').addEventListener('click',addBookmark);
    $('readerWakeButton').addEventListener('click',retryWakeLock);
    $('bookmarksOv').addEventListener('click',event=>{if(event.target===$('bookmarksOv')) closeBookmarks();});
    $('bookmarksOv').addEventListener('keydown',event=>{
      if(event.key!=='Tab') return;
      const targets=[...$('bookmarksOv').querySelectorAll('button:not(:disabled),a[href]')].filter(el=>el.getClientRects().length);
      const first=targets[0],last=targets[targets.length-1];
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
    });
    window.addEventListener('resize',()=>{layoutPending=true;});
    $('pages').addEventListener('scroll',event=>{
      const fol=currentFolio();
      if(event.target!==fol || restoring || readyPage!==currentPage()) return;
      if(layoutPending || (geometryStamp && geometry(fol)!==geometryStamp)){
        window.relayout?.();return;
      }
      // User scrolls update the point immediately; writing is still debounced.
      // flush() also detects a scroll if navigation precedes its scroll event.
      capture();scheduleSave();
    },{capture:true,passive:true});
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='hidden'){flush();releaseWakeLock();}
      else if(active){wakeRecoveries=0;gestureRetried=false;ensureWakeLock();scheduleSave();}
    });
    window.addEventListener('pagehide',()=>{flush();active=false;releaseWakeLock();});
    window.addEventListener('pageshow',()=>{
      active=true;wakeRecoveries=0;gestureRetried=false;ensureWakeLock();
      const fol=currentFolio();
      if(fol?.dataset.fitted==='1' && (restoring || readyPage!==currentPage())) onPageReady(fol);
      else scheduleSave();
    });
    document.addEventListener('pointerdown',()=>{
      if(wakePermission!=='denied' && !wakeLease && !wakePending && wakeSupported() && (!gestureRetried || Date.now()-lastWakeAttempt>10000)){
        gestureRetried=true;wakeRecoveries=0;ensureWakeLock();
      }
    },{passive:true});
    window.addEventListener('storage',event=>{
      if(event.key===BOOKMARKS_KEY || event.key===null){bookmarks=readBookmarks();updateButton();if($('bookmarksOv').classList.contains('show')) renderBookmarks();}
    });
    if(wakeSupported() && navigator.permissions?.query){
      navigator.permissions.query({name:'screen-wake-lock'}).then(permission=>{
        wakePermission=permission.state;
        permission.addEventListener('change',()=>{
          wakePermission=permission.state;
          if(permission.state==='granted' && active && document.visibilityState==='visible'){
            wakeRecoveries=0;ensureWakeLock();
          }
          if(permission.state==='denied'){
            releaseWakeLock();if(active && document.visibilityState==='visible') wakeState('denied');
          }
        });
      }).catch(()=>{});
    }
    ensureWakeLock();
    return saved;
  }
  window.MushafReading=Object.freeze({start,beforeShow,onPageReady,beforeLayout,afterLayout,
    openBookmarks,closeBookmarks,addBookmark,retryWakeLock,flush,releaseWakeLock});
})();
