/* Visible official YouTube playback for Ragheb's video lessons. No hidden
   audio-only iframe, stream extraction, or unbounded polling. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  let apiPromise=null,apiScript=null,apiTimer=null,apiAttempt=0;
  let player=null,selection=null,callbacks=null,revision=0,readyTimer=null;

  function api(){
    if(typeof window.YT?.Player==='function')return Promise.resolve(window.YT);
    if(apiPromise)return apiPromise;
    const attempt=++apiAttempt;
    apiPromise=new Promise((resolve,reject)=>{
      let settled=false;
      function fail(){
        if(settled || attempt!==apiAttempt)return;settled=true;
        clearTimeout(apiTimer);apiPromise=null;apiScript?.remove();apiScript=null;
        reject(new Error('YouTube API unavailable'));
      }
      window.onYouTubeIframeAPIReady=()=>{
        if(settled || attempt!==apiAttempt)return;
        if(typeof window.YT?.Player!=='function'){fail();return;}
        settled=true;clearTimeout(apiTimer);resolve(window.YT);
      };
      apiScript=document.createElement('script');apiScript.src='https://www.youtube.com/iframe_api';apiScript.async=true;
      apiScript.referrerPolicy='strict-origin-when-cross-origin';apiScript.onerror=fail;
      apiTimer=setTimeout(fail,15000);document.head.appendChild(apiScript);
    });
    return apiPromise;
  }
  function state(name,message){
    $('youtubePanel').dataset.state=name;
    if(message)$('youtubeMessage').textContent=message;
    $('youtubeRetry').hidden=!['error','slow','blocked'].includes(name);
    callbacks?.onState?.(name);
  }
  function errorMessage(code){
    if(code===100)return 'هذا الفيديو غير متاح حاليًا على YouTube. جرّب حلقة أخرى أو افتح المصدر.';
    if(code===101||code===150)return 'لا يسمح صاحب الفيديو بتشغيله داخل المواقع. يمكنك مشاهدته على YouTube من الرابط.';
    if(code===153)return 'تعذّر تهيئة مشغّل YouTube في هذا المتصفح. أعد المحاولة أو افتح الدرس على YouTube.';
    if(code===5)return 'تعذّر تشغيل الفيديو في هذا المتصفح. أعد المحاولة أو افتح المصدر.';
    return 'تعذّر تحميل مشغّل YouTube. تحقّق من الاتصال أو افتح الدرس على YouTube.';
  }
  function stop(){
    revision++;clearTimeout(readyTimer);readyTimer=null;
    const previous=player;player=null;selection=null;callbacks=null;
    try{previous?.destroy();}catch(e){}
    $('youtubeStage').replaceChildren();$('youtubePanel').hidden=true;document.body.classList.remove('yt-view');
    $('youtubePanel').dataset.state='idle';
  }
  async function play(lesson,handlers){
    if(!lesson || !/^[a-zA-Z0-9_-]{11}$/.test(lesson.id))return;
    stop();selection={...lesson};callbacks=handlers||{};
    const stamp=revision;
    $('youtubePanel').hidden=false;document.body.classList.add('yt-view');
    $('youtubeSource').href='https://www.youtube.com/watch?v='+lesson.id;
    $('youtubeSource').setAttribute('aria-label','فتح '+lesson.name+' على YouTube');
    state('loading','جارٍ تحميل المشغّل الرسمي… إذا لم يبدأ الدرس، اضغط ▶ داخل الفيديو.');
    try{
      const YT=await api();
      if(stamp!==revision || !selection)return;
      // The API replaces a DIV with its own iframe. Attaching it to a blank
      // pre-existing iframe never creates the embed URL/ready handshake.
      const mount=document.createElement('div');mount.id='raghebYoutubeMount';
      $('youtubeStage').replaceChildren(mount);
      readyTimer=setTimeout(()=>{
        if(stamp===revision)state('slow','تحميل YouTube يستغرق وقتًا أطول من المعتاد. جرّب إعادة المحاولة أو فتح المصدر.');
      },18000);
      player=new YT.Player(mount,{
        host:'https://www.youtube-nocookie.com',
        width:'100%',height:'100%',videoId:lesson.id,
        playerVars:{autoplay:1,controls:1,playsinline:1,rel:0,origin:location.origin,hl:'ar'},
        events:{
          onReady:event=>{
            if(stamp!==revision){try{event.target.destroy();}catch(e){}return;}
            clearTimeout(readyTimer);
            const frame=event.target.getIframe();
            frame.title=lesson.name+' — مشغّل YouTube';
            frame.setAttribute('allow','autoplay; encrypted-media; fullscreen; picture-in-picture');
            frame.setAttribute('allowfullscreen','');
            frame.referrerPolicy='strict-origin-when-cross-origin';
            state('ready','إذا لم يبدأ الدرس، اضغط ▶ داخل الفيديو. الصوت والإيقاف وملء الشاشة من أزرار المشغّل.');
          },
          onStateChange:event=>{
            if(stamp!==revision)return;
            if(event.data===YT.PlayerState.PLAYING){clearTimeout(readyTimer);state('playing','الصوت والإيقاف وملء الشاشة من أزرار مشغّل YouTube.');}
            else if(event.data===YT.PlayerState.BUFFERING)state('buffering','جارٍ تحميل الفيديو…');
            else if(event.data===YT.PlayerState.PAUSED)state('paused','متوقف مؤقتًا. اضغط ▶ داخل الفيديو للمتابعة.');
            else if(event.data===YT.PlayerState.ENDED){state('ended');callbacks?.onEnded?.();}
          },
          onError:event=>{if(stamp===revision){clearTimeout(readyTimer);state('error',errorMessage(event.data));}},
          onAutoplayBlocked:()=>{if(stamp===revision){clearTimeout(readyTimer);state('blocked','المتصفح يحتاج ضغطة تشغيل. اضغط ▶ داخل الفيديو لبدء الدرس.');}}
        }
      });
      const frame=player.getIframe?.();
      if(frame){
        frame.title=lesson.name+' — مشغّل YouTube';
        frame.referrerPolicy='strict-origin-when-cross-origin';
        frame.setAttribute('allow','autoplay; encrypted-media; fullscreen; picture-in-picture');
        frame.setAttribute('allowfullscreen','');
      }
    }catch(e){
      if(stamp===revision)state('error',errorMessage());
    }
  }
  function retry(){if(selection)play(selection,callbacks);}
  $('youtubeRetry').addEventListener('click',retry);
  $('youtubeSource').addEventListener('click',()=>{
    // Open the official source only on a user click; do not leave embedded
    // playback running alongside it. Keep href intact for the default action.
    const url=$('youtubeSource').href;stop();$('youtubeSource').href=url;
    if(typeof LessonPlayer!=='undefined')LessonPlayer.stopLesson();
  });
  window.addEventListener('pagehide',stop);
  window.RaghebVideo=Object.freeze({play,stop,retry});
})();
