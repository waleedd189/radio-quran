/* Official, visible SoundCloud audio widgets. Use stable public track IDs and
   permalinks, not extracted/expiring media URLs. One widget at a time. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  let apiPromise=null,apiAttempt=0,widget=null,frame=null,selection=null,callbacks=null;
  let revision=0,readyTimer=null,playTimer=null,finished=false,wanted=false;
  function api(){
    if(typeof window.SC?.Widget==='function')return Promise.resolve(window.SC);
    if(apiPromise)return apiPromise;
    const attempt=++apiAttempt;
    apiPromise=new Promise((resolve,reject)=>{
      const tag=document.createElement('script');let settled=false;
      const fail=()=>{if(settled||attempt!==apiAttempt)return;settled=true;clearTimeout(timer);tag.remove();apiPromise=null;reject(Error('SoundCloud API unavailable'));};
      const timer=setTimeout(fail,12000);
      tag.src='https://w.soundcloud.com/player/api.js';tag.async=true;
      tag.referrerPolicy='strict-origin-when-cross-origin';tag.onerror=fail;
      tag.onload=()=>{if(settled||attempt!==apiAttempt)return;if(typeof window.SC?.Widget!=='function'){fail();return;}settled=true;clearTimeout(timer);resolve(window.SC);};
      document.head.appendChild(tag);
    });
    return apiPromise;
  }
  function state(name,message){
    const changed=$('soundcloudPanel').dataset.state!==name;
    $('soundcloudPanel').dataset.state=name;
    if(message && $('soundcloudMessage').textContent!==message)$('soundcloudMessage').textContent=message;
    $('soundcloudRetry').hidden=!['error','slow','ready','blocked'].includes(name);
    if(changed)callbacks?.onState?.(name);
  }
  function stop(){
    revision++;clearTimeout(readyTimer);clearTimeout(playTimer);readyTimer=playTimer=null;
    const old=widget;widget=null;wanted=false;finished=false;selection=null;callbacks=null;
    try{old?.pause();}catch(e){}
    if(frame){frame.src='about:blank';frame.remove();frame=null;}
    $('soundcloudHost').replaceChildren();$('soundcloudPanel').hidden=true;
    $('soundcloudPanel').dataset.state='idle';document.body.classList.remove('sc-view');
  }
  async function play(lesson,handlers={}){
    if(!lesson || !/^\d+$/.test(String(lesson.id)) || !/^https:\/\/soundcloud\.com\//.test(lesson.url))return;
    stop();selection={...lesson};callbacks=handlers;wanted=true;const stamp=revision;
    $('soundcloudPanel').hidden=false;document.body.classList.add('sc-view');
    $('soundcloudSource').href=lesson.url;
    $('soundcloudSource').setAttribute('aria-label','فتح '+lesson.name+' على SoundCloud');
    state('loading','جارٍ فتح المشغّل الصوتي… لو لم يبدأ الصوت، اضغط ▶ داخل مشغّل SoundCloud.');
    try{
      const SC=await api();if(stamp!==revision||!selection)return;
      frame=document.createElement('iframe');frame.id='raghebSoundcloudFrame';frame.title=lesson.name+' — SoundCloud';
      frame.allow='autoplay; encrypted-media';frame.referrerPolicy='strict-origin-when-cross-origin';
      frame.setAttribute('scrolling','no');
      const url=new URL('https://w.soundcloud.com/player/');
      Object.entries({url:'https://api.soundcloud.com/tracks/'+lesson.id,auto_play:'true',visual:'false',hide_related:'true',show_comments:'false',show_reposts:'false',show_artwork:'true',show_user:'true',single_active:'true',color:'#26a69a'}).forEach(([key,value])=>url.searchParams.set(key,value));
      frame.src=url.href;$('soundcloudHost').replaceChildren(frame);
      widget=SC.Widget(frame);const currentWidget=widget;
      readyTimer=setTimeout(()=>{if(stamp===revision)state('slow','التحميل يستغرق وقتًا. جرّب إعادة المحاولة أو افتح التسجيل على SoundCloud.');},20000);
      widget.bind(SC.Widget.Events.READY,()=>{
        if(stamp!==revision)return;
        clearTimeout(readyTimer);readyTimer=null;
        currentWidget.getCurrentSound(sound=>{
          if(stamp!==revision)return;
          if(!sound || String(sound.id)!==String(lesson.id)){
            wanted=false;try{currentWidget.pause();}catch(e){}
            state('error','تعذّر تحميل التسجيل المطلوب من SoundCloud. يمكنك فتح رابط المصدر مباشرة.');return;
          }
          state('ready','اضغط ▶ داخل SoundCloud إذا لم يبدأ الصوت. يمكنك التحكم في الوقت والصوت من المشغّل.');
          // Some browsers require a click inside the cross-origin widget.
          // Never leave the outer page showing an endless loading spinner.
          try{currentWidget.play();}catch(e){}
          playTimer=setTimeout(()=>{if(stamp===revision && wanted && $('soundcloudPanel').dataset.state!=='playing')state('blocked','اضغط ▶ داخل المشغّل للسماح بتشغيل الصوت في المتصفح.');},8000);
        });
      });
      widget.bind(SC.Widget.Events.PLAY,()=>{
        if(stamp!==revision)return;
        currentWidget.getCurrentSound(sound=>{
          if(stamp!==revision)return;
          if(String(sound?.id)!==String(lesson.id)){
            wanted=false;try{currentWidget.pause();}catch(e){}
            state('error','اختر التسجيل المطلوب من قائمة السلسلة في الصفحة.');return;
          }
          finished=false;wanted=true;
        });
      });
      widget.bind(SC.Widget.Events.PLAY_PROGRESS,progress=>{
        if(stamp!==revision || !wanted || finished || !(progress.currentPosition>0))return;
        clearTimeout(readyTimer);clearTimeout(playTimer);
        state('playing','الصوت يعمل من SoundCloud. استخدم أزرار المشغّل للإيقاف المؤقت والتقديم.');
      });
      widget.bind(SC.Widget.Events.PAUSE,()=>{
        if(stamp!==revision || finished || $('soundcloudPanel').dataset.state==='error')return;
        wanted=false;clearTimeout(playTimer);state('paused','متوقف مؤقتًا. اضغط ▶ داخل المشغّل للمتابعة.');
      });
      widget.bind(SC.Widget.Events.FINISH,()=>{
        if(stamp!==revision || finished)return;
        finished=true;wanted=false;try{currentWidget.pause();}catch(e){}
        state('ended','انتهى التسجيل.');callbacks?.onEnded?.();
      });
      if(SC.Widget.Events.ERROR)widget.bind(SC.Widget.Events.ERROR,()=>{
        if(stamp!==revision)return;
        wanted=false;clearTimeout(readyTimer);clearTimeout(playTimer);try{currentWidget.pause();}catch(e){}
        state('error','تعذّر تشغيل التسجيل من SoundCloud. أعد المحاولة أو افتحه من رابط المصدر.');
      });
    }catch(e){if(stamp===revision){wanted=false;state('error','تعذّر تحميل مشغّل SoundCloud. تحقّق من الاتصال أو افتح رابط المصدر.');}}
  }
  function retry(){if(selection)play(selection,callbacks);}
  $('soundcloudRetry').addEventListener('click',retry);
  $('soundcloudSource').addEventListener('click',()=>{if(typeof LessonPlayer!=='undefined')LessonPlayer.stopLesson();else stop();});
  window.addEventListener('pagehide',stop);
  window.RaghebSoundCloud=Object.freeze({play,stop,retry});
})();
