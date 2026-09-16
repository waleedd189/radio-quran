/* Native video/audio modes for the supplied Archive episodes. MP4 and OGV are
   two formats of the SAME lesson. Audio mode uses the video file, not a separate
   MP3; the UI says so. No media bytes are bundled or preloaded before selection. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const audio=$('audioPlayer'),video=$('archiveVideo'),home=$('audioPlayerHome');
  const allowed=/^https:\/\/archive\.org\/download\/Islamic_Tape-484_uP_bY_mUSLEm\/muslem\.ettounsi-(?:00[1-9]|01[0-9]|02[0-2])\.(?:mp4|ogv)$/;
  let selected=null,callbacks=null,mode='video',active=null,revision=0,wanted=false,changing=false;
  let pendingTime=0,loadingTimer=null,endedRevision=-1;
  let settings={volume:audio.volume,muted:audio.muted,rate:audio.playbackRate};
  function stamp(){return selected?.video||'';}
  function currentTime(){return active && active.readyState>0?active.currentTime:pendingTime;}
  function status(state,message){
    $('archivePanel').dataset.state=state;
    if(message)$('archiveMessage').textContent=message;
    $('archiveRetry').hidden=!['error','slow','blocked'].includes(state);
    callbacks?.onState?.(state,mode);
  }
  function pauseAndUnload(element){
    try{element.pause();element.removeAttribute('src');element.querySelectorAll('source').forEach(source=>source.remove());element.load();}catch(e){}
  }
  function reset(){
    revision++;clearTimeout(loadingTimer);loadingTimer=null;
    if(active)settings={volume:active.volume,muted:active.muted,rate:active.playbackRate};
    active=null;wanted=false;changing=true;pendingTime=0;
    pauseAndUnload(audio);pauseAndUnload(video);
  }
  function stop(){
    reset();selected=null;callbacks=null;video.hidden=true;
    if(audio.parentNode!==home)home.appendChild(audio);
    audio.hidden=false;$('archivePanel').hidden=true;$('archivePanel').dataset.state='idle';
    document.body.classList.remove('archive-view');
  }
  function setSources(element,lesson){
    const sources=[];
    const mp4=document.createElement('source');mp4.src=lesson.video;
    mp4.type=mode==='audio'?'audio/mp4':'video/mp4';sources.push(mp4);
    if(lesson.alternateVideo && allowed.test(lesson.alternateVideo)){
      const ogv=document.createElement('source');ogv.src=lesson.alternateVideo;
      ogv.type=mode==='audio'?'audio/ogg':'video/ogg';sources.push(ogv);
    }
    const ticket=revision,failed=new Set();
    sources.forEach(source=>{
      // With <source> children some browsers leave play() pending instead of
      // rejecting it when every candidate fails. Observe source errors too.
      source.addEventListener('error',()=>{
        if(ticket!==revision || active!==element || !selected)return;
        failed.add(source);
        if(failed.size===sources.length)showError();
      });
      element.appendChild(source);
    });
  }
  function showError(){
    wanted=false;clearTimeout(loadingTimer);loadingTimer=null;
    status('error',navigator.onLine===false
      ?'لا يوجد اتصال بالإنترنت. حاول مرة أخرى عند عودة الشبكة.'
      :'تعذّر تشغيل الحلقة. أعد المحاولة أو افتح MP4 / OGV من روابط المصدر.');
    try{active?.pause();}catch(e){}
  }
  function watchLoading(){
    clearTimeout(loadingTimer);const ticket=revision;
    loadingTimer=setTimeout(()=>{
      if(ticket===revision && active && wanted && active.readyState<3)status('slow','تحميل الحلقة يستغرق وقتًا. ملفات الفيديو كبيرة؛ يمكنك الانتظار أو إعادة المحاولة.');
    },25000);
  }
  function play(lesson,nextMode='video',handlers={},options={}){
    if(!lesson || !allowed.test(lesson.video))return;
    const same=stamp()===lesson.video;
    const nextTime=Number.isFinite(options.seek)?options.seek:(same && nextMode!==mode?currentTime():0);
    const nextWanted=options.play!==false;
    if(!selected)settings={volume:audio.volume,muted:audio.muted,rate:audio.playbackRate};
    reset();selected={...lesson};callbacks=handlers;mode=nextMode==='audio'?'audio':'video';
    pendingTime=Math.max(0,nextTime||0);wanted=nextWanted;
    const ticket=revision;
    $('archivePanel').hidden=false;document.body.classList.add('archive-view');
    $('archiveAudioSlot').appendChild(audio);
    video.hidden=mode!=='video';audio.hidden=mode!=='audio';
    active=mode==='audio'?audio:video;
    active.setAttribute('aria-label',lesson.name+(mode==='audio'?' — صوت فقط':' — فيديو'));
    $('archiveModeVideo').setAttribute('aria-pressed',String(mode==='video'));
    $('archiveModeAudio').setAttribute('aria-pressed',String(mode==='audio'));
    $('archiveSourceMp4').href=lesson.video;$('archiveSourceOgv').href=lesson.alternateVideo||lesson.video;
    $('archiveBandwidthNote').textContent=mode==='audio'
      ?'وضع الصوت يشغّل المسار الصوتي من نفس ملف الفيديو، وليس MP3 مستقلًا؛ لذلك لا يُضمن توفير بيانات الإنترنت.'
      :'MP4 هو المصدر الأساسي، وOGV صيغة بديلة لنفس الحلقة. التشغيل يبدأ عند اختيارك فقط؛ لا نحمّل السلسلة كاملة.';
    callbacks?.onMode?.(mode);
    setSources(active,lesson);
    active.preload=wanted?'none':'metadata';active.load();
    try{active.volume=settings.volume;active.muted=settings.muted;active.playbackRate=settings.rate;}catch(e){}
    if(wanted){status('loading',mode==='audio'?'جارٍ تجهيز صوت الحلقة…':'جارٍ تحميل الفيديو…');watchLoading();}
    else status('paused','متوقف مؤقتًا. اضغط التشغيل للمتابعة من نفس الموضع.');
    if(wanted){
      active.play().catch(error=>{
        if(ticket!==revision || !selected || !wanted || error.name==='AbortError')return;
        if(error.name==='NotAllowedError'){
          wanted=false;clearTimeout(loadingTimer);status('blocked','اضغط زر التشغيل في المشغّل للسماح بتشغيل الحلقة.');
        }else showError();
      });
    }
  }
  function switchMode(next){
    if(!selected || next===mode)return;
    const lesson=selected,handlers=callbacks,position=currentTime(),wasPlaying=wanted || (active && !active.paused);
    play(lesson,next,handlers,{seek:position,play:!!wasPlaying});
  }
  function retry(){if(selected)play(selected,mode,callbacks,{seek:currentTime(),play:true});}
  for(const element of [audio,video]){
    element.addEventListener('loadstart',()=>{
      if(element!==active || !selected)return;changing=false;
      if(wanted){status('loading','جارٍ تحميل الحلقة…');watchLoading();}
    });
    element.addEventListener('loadedmetadata',()=>{
      if(element!==active || !selected)return;
      // load() resets playbackRate to defaultPlaybackRate; restore the chosen
      // rate after metadata becomes available, including paused mode switches.
      try{element.playbackRate=settings.rate;}catch(e){}
      if(element===video && video.videoWidth && video.videoHeight)video.style.aspectRatio=video.videoWidth+'/'+video.videoHeight;
      if(pendingTime>0){
        try{element.currentTime=Math.min(pendingTime,Number.isFinite(element.duration)?Math.max(0,element.duration-.5):pendingTime);pendingTime=0;}catch(e){}
      }
      if(!wanted){clearTimeout(loadingTimer);status('paused','متوقف مؤقتًا. اضغط التشغيل للمتابعة من نفس الموضع.');}
    });
    element.addEventListener('play',()=>{
      if(element!==active || !selected)return;wanted=true;
    });
    element.addEventListener('playing',()=>{
      if(element!==active || !selected || element.paused)return;
      wanted=true;clearTimeout(loadingTimer);loadingTimer=null;
      status('playing',mode==='audio'?'يُشغَّل صوت الحلقة الآن.':'الفيديو يعمل الآن؛ يمكنك استخدام زر ملء الشاشة في المشغّل.');
    });
    element.addEventListener('waiting',()=>{if(element===active && selected && wanted){status('buffering','جارٍ تحميل مزيد من الحلقة…');watchLoading();}});
    element.addEventListener('pause',()=>{
      if(element!==active || !selected || changing || !element.paused || element.error || element.ended || $('archivePanel').dataset.state==='error')return;
      wanted=false;clearTimeout(loadingTimer);status('paused','متوقف مؤقتًا. يمكنك تغيير وضع العرض مع الاحتفاظ بالموضع.');
    });
    element.addEventListener('error',()=>{if(element===active && selected && element.error)showError();});
    element.addEventListener('ended',()=>{
      if(element!==active || !selected || !element.ended || endedRevision===revision)return;
      endedRevision=revision;wanted=false;clearTimeout(loadingTimer);status('ended','انتهت الحلقة.');callbacks?.onEnded?.();
    });
  }
  $('archiveModeVideo').addEventListener('click',()=>switchMode('video'));
  $('archiveModeAudio').addEventListener('click',()=>switchMode('audio'));
  $('archiveRetry').addEventListener('click',retry);
  for(const id of ['archiveSourceMp4','archiveSourceOgv'])$(id).addEventListener('click',()=>{
    if(typeof LessonPlayer!=='undefined')LessonPlayer.stopLesson();else stop();
  });
  window.addEventListener('pagehide',stop);
  window.RaghebArchiveMedia=Object.freeze({play,stop,switchMode,retry});
})();
