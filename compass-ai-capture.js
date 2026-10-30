/* One user-authorized frame, local crop only. No network, recorder or storage. */
(()=>{
 'use strict';
 function cropRect(a,b,w,h){const x=Math.max(0,Math.min(w,Math.round(Math.min(a.x,b.x)))),y=Math.max(0,Math.min(h,Math.round(Math.min(a.y,b.y))));const right=Math.max(x,Math.min(w,Math.round(Math.max(a.x,b.x)))),bottom=Math.max(y,Math.min(h,Math.round(Math.max(a.y,b.y))));return {x,y,w:right-x,h:bottom-y};}
 function captureError(error){switch(error?.name){case 'NotAllowedError':case 'SecurityError':return '画面共有がキャンセルされたか、許可されませんでした。画像添付・貼り付けも利用できます。';case 'NotFoundError':return '取得できる画面が見つかりません。対象のタブ・ウィンドウを開いてください。';case 'OverconstrainedError':return '取得画面が大きすぎます。対象のウィンドウを小さくするか、単一のタブを選択してください。';case 'NotReadableError':return '画面を取得できません。OSの画面収録権限や対象ウィンドウを確認してください。';case 'InvalidStateError':return 'COMPASSに戻り、「範囲を読み取る」を直接クリックしてください。';case 'AbortError':return '画面共有が終了しました。画像は送信していません。';case 'NotSupportedError':case 'TypeError':return 'この環境では画面取得を利用できません。画像添付・貼り付けをご利用ください。';default:return '画面を取得できませんでした。画像は送信していません。画像添付・貼り付けも利用できます。';}}
 if(typeof module!=='undefined')module.exports={cropRect,captureError};if(typeof window==='undefined')return;
 window.CompassScreenCapture={create(root,{onChange,status,isBusy,getCount,onCrop}){
  let active=false,epoch=0,stream=null,video=null,frame=null,dialog=null,cancelFrame=null,localOverlay=null,localRestore=null;
  const supported=()=>Boolean(window.isSecureContext&&navigator.mediaDevices?.getDisplayMedia&&!/Android|iPhone|iPad|iPod/.test(navigator.userAgent)&&!(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1));
  function stop(){for(const track of stream?.getTracks()||[])try{track.stop();}catch{}stream=null;if(video){video.pause();video.srcObject=null;video.remove();video=null;}}
  function discard(){if(frame){frame.width=frame.height=1;frame=null;}if(dialog){const d=dialog;dialog=null;if(d.open)d.close();d.remove();}}
  function clear(){epoch++;cancelFrame?.();cancelFrame=null;stop();discard();localOverlay?.remove();localOverlay=null;localRestore?.();localRestore=null;active=false;onChange();}
  function choose(){
   if(active||isBusy())return;
   const d=document.createElement('dialog');d.className='ca-capture-dialog ca-capture-choice';
   d.innerHTML='<strong>読み取る範囲を選ぶ</strong><p>COMPASS内は直接選択できます。別タブ・PDF・別アプリは範囲スクショを貼り付けてください。他アプリを自動取得しません。</p><button type="button" data-capture="local">COMPASS内を範囲選択（文字・表）</button><button type="button" data-capture="paste">範囲スクショを貼り付ける</button><button type="button" data-capture="share">画面共有から取得（補助）</button><button type="button" data-capture="cancel">閉じる</button><p>Mac：Command＋Control＋Shift＋4 → 範囲を囲む → COMPASSでCommand＋V。Windows：Win＋Shift＋S → Ctrl＋V。画像やPDFの見た目を正確に取り込む場合もこちらを使います。</p>';
   dialog=d;root.append(d);
   d.querySelector('[data-capture="share"]').disabled=!supported();
   d.addEventListener('click',e=>{const action=e.target.dataset.capture;if(!action)return;dialog=null;d.close();d.remove();if(action==='local')startLocal();else if(action==='share')start();else if(action==='paste'){status('範囲スクショ後、このチャットの入力欄に貼り付けてください。Mac：Command＋Control＋Shift＋4 → Command＋V。Windows：Win＋Shift＋S → Ctrl＋V。貼り付け後は個人情報を黒塗りし、送信用プレビューを確認します。');root.querySelector('textarea')?.focus();}});
   d.addEventListener('cancel',()=>{dialog=null;d.remove();});d.showModal();
  }
  function startLocal(){
   if(active||isBusy())return;if(getCount()>=2){status('画像は1回に2枚までです。');return;}
   const own=++epoch;active=true;onChange();
   const previous=root.style.visibility;root.style.visibility='hidden';localRestore=()=>{root.style.visibility=previous;};
   const overlay=document.createElement('div');overlay.className='ca-local-select';overlay.innerHTML='<div class="ca-local-help">COMPASSの必要な文字・表をドラッグして選択（Escで中止）<br>画像・グラフ・PDF・入力欄は再現しません。見た目が必要なら範囲スクショ貼り付けを使ってください。</div><div class="ca-local-box" hidden></div>';
   localOverlay=overlay;document.body.append(overlay);const box=overlay.querySelector('.ca-local-box');let origin=null;
   const key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();clear();status('範囲選択をキャンセルしました。');}};document.addEventListener('keydown',key,true);
   const restore=localRestore;localRestore=()=>{document.removeEventListener('keydown',key,true);restore();};
   overlay.addEventListener('pointerdown',e=>{origin={x:e.clientX,y:e.clientY};overlay.setPointerCapture(e.pointerId);});
   overlay.addEventListener('pointermove',e=>{if(!origin)return;const r=cropRect(origin,{x:e.clientX,y:e.clientY},innerWidth,innerHeight);box.hidden=false;box.style.cssText=`left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;});
   overlay.addEventListener('pointerup',async e=>{
    if(!origin)return;const r=cropRect(origin,{x:e.clientX,y:e.clientY},innerWidth,innerHeight);origin=null;if(r.w<32||r.h<32){box.hidden=true;return;}
    overlay.remove();localOverlay=null;
    try{const canvas=renderLocal(r);localRestore?.();localRestore=null;if(own!==epoch)return;const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));canvas.width=canvas.height=1;if(own!==epoch)return;if(!blob)throw Error();await onCrop(new File([blob],'COMPASS内の選択範囲.png',{type:'image/png'}));status('選択した文字・表を端末内で画像化しました。表示内容を確認し、必要な黒塗り後、送信用プレビューを作成してください。');}
    catch{if(own===epoch)status('この範囲を画像化できませんでした。範囲スクショの貼り付けか画面共有をご利用ください。');}
    finally{if(own===epoch){localRestore?.();localRestore=null;active=false;onChange();}}
   });overlay.addEventListener('pointercancel',()=>{clear();status('範囲選択をキャンセルしました。');});
  }
  function renderLocal(r){
   // Render selected visible DOM text/table geometry, not a hidden screen capture.
   // No serialization, external resources, network, business API or offscreen bitmap.
   const out=document.createElement('canvas'),scale=Math.min(1,1600/Math.max(r.w,r.h));out.width=Math.max(32,Math.round(r.w*scale));out.height=Math.max(32,Math.round(r.h*scale));const ctx=out.getContext('2d');ctx.scale(scale,scale);ctx.translate(-r.x,-r.y);ctx.fillStyle='#fff';ctx.fillRect(r.x,r.y,r.w,r.h);
   const intersects=b=>b.width&&b.height&&b.right>r.x&&b.bottom>r.y&&b.left<r.x+r.w&&b.top<r.y+r.h;
   const excluded=e=>e.closest('#compassAi,.ca-local-select,script,style,noscript,input,textarea,select,iframe,video,canvas,svg,[hidden],[aria-hidden="true"]');
   let characters=0;
   for(const el of document.body.querySelectorAll('*')){if(excluded(el))continue;const b=el.getBoundingClientRect();if(!intersects(b))continue;const s=getComputedStyle(el);if(s.visibility!=='visible'||s.display==='none'||Number(s.opacity)===0)continue;
    // Only draw boxes that are visibly on top at their center; text has a per-glyph check below.
    const x=Math.max(r.x,b.left),y=Math.max(r.y,b.top),w=Math.min(r.x+r.w,b.right)-x,h=Math.min(r.y+r.h,b.bottom)-y,top=document.elementFromPoint(x+w/2,y+h/2);
    if(top&&(top===el||el.contains(top))){if(s.backgroundColor!=='rgba(0, 0, 0, 0)'){ctx.fillStyle=s.backgroundColor;ctx.fillRect(x,y,w,h);}if(parseFloat(s.borderTopWidth)>0){ctx.strokeStyle=s.borderTopColor;ctx.lineWidth=1;ctx.strokeRect(b.left,b.top,b.width,b.height);}}
   }
   const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;
   while(node=walker.nextNode()){const el=node.parentElement;if(!el||excluded(el))continue;const s=getComputedStyle(el),b=el.getBoundingClientRect();if(!intersects(b)||s.visibility!=='visible'||s.display==='none'||Number(s.opacity)===0||!node.textContent.trim())continue;ctx.font=`${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;ctx.textBaseline='top';ctx.fillStyle=s.color;
    for(let i=0;i<node.length;){const char=String.fromCodePoint(node.textContent.codePointAt(i)),range=document.createRange();range.setStart(node,i);range.setEnd(node,i+char.length);i+=char.length;const g=range.getBoundingClientRect();if(!intersects(g)||!char.trim())continue;const top=document.elementFromPoint(Math.max(0,Math.min(innerWidth-1,g.left+g.width/2)),Math.max(0,Math.min(innerHeight-1,g.top+g.height/2)));if(!top||!(top===el||el.contains(top)))continue;
     if(++characters>10000)throw Error('too much text');ctx.fillText(char,g.left,g.top+Math.max(0,(g.height-parseFloat(s.fontSize))/2));
    }
   }
   if(!characters)throw Error('no readable text');return out;
  }
  async function start(){
   if(active||isBusy())return;
   if(!supported()){status('この環境では範囲読み取りに対応していません。画像添付・貼り付けをご利用ください。');return;}
   if(getCount()>=2){status('画像は1回に2枚までです。既存画像を削除してから取得してください。');return;}
   const own=++epoch;active=true;onChange();status('ブラウザの選択画面で対象のタブ・ウィンドウ・画面を選んで許可してください。');
   try{
    // Called synchronously from the button gesture; no permission/source reuse.
    const picked=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false,selfBrowserSurface:'include',surfaceSwitching:'exclude',systemAudio:'exclude',monitorTypeSurfaces:'include'});
    if(own!==epoch){picked.getTracks().forEach(t=>t.stop());return;}
    stream=picked;const track=stream.getVideoTracks()[0];if(!track||track.readyState==='ended')throw new DOMException('ended','AbortError');
    video=document.createElement('video');video.muted=true;video.playsInline=true;
    await new Promise((resolve,reject)=>{const target=video;let done=false;const finish=error=>{if(done)return;done=true;clearTimeout(timer);target.removeEventListener('loadeddata',check);target.removeEventListener('error',failed);track.removeEventListener('ended',ended);cancelFrame=null;error?reject(error):resolve();};const check=()=>{if(target.readyState>=2&&target.videoWidth&&target.videoHeight)finish();};const ended=()=>finish(new DOMException('ended','AbortError')),failed=()=>finish(new DOMException('read','NotReadableError'));const timer=setTimeout(failed,10000);cancelFrame=ended;target.addEventListener('loadeddata',check);target.addEventListener('error',failed);track.addEventListener('ended',ended);target.srcObject=stream;target.play().then(check,failed);});
    if(own!==epoch)return;
    const w=video.videoWidth,h=video.videoHeight;if(w<32||h<32||w>8192||h>8192||w*h>20000000)throw new DOMException('size','OverconstrainedError');
    frame=document.createElement('canvas');frame.width=w;frame.height=h;frame.getContext('2d').drawImage(video,0,0,w,h);
    stop(); // Stop every track BEFORE showing the still-image preview.
    status('画面共有は停止しました。COMPASS内のプレビューで必要部分を囲んでください。');
    showCrop(own);
   }catch(error){if(own===epoch){stop();discard();active=false;onChange();status(captureError(error));}}
   finally{if(own===epoch)stop();}
  }
  function showCrop(own){
   const source=frame;dialog=document.createElement('dialog');dialog.className='ca-capture-dialog';dialog.innerHTML='<div class="ca-capture-head"><strong>読み取る範囲を囲む</strong><button type="button" data-capture="cancel">キャンセル</button></div><p>共有は停止済みです。この静止画は端末内だけにあります。必要部分をドラッグし、切り抜いた後に個人情報の黒塗り・送信確認を行います。</p><div class="ca-crop-stage"><div class="ca-crop-box" hidden></div></div><p class="ca-crop-size" role="status">範囲を指定してください（32×32px以上）</p><div class="ca-capture-actions"><button type="button" data-capture="reset">選び直す</button><button type="button" data-capture="crop" disabled>この範囲を切り抜く</button></div>';
   const d=dialog,stage=d.querySelector('.ca-crop-stage'),box=d.querySelector('.ca-crop-box'),apply=d.querySelector('[data-capture="crop"]');stage.prepend(source);source.setAttribute('aria-label','取得した画面の範囲選択');root.append(d);let startPoint=null,selection=null;
   const point=e=>{const b=source.getBoundingClientRect();return {x:(e.clientX-b.left)*source.width/b.width,y:(e.clientY-b.top)*source.height/b.height};};
   const show=()=>{box.hidden=!selection;if(selection){box.style.cssText=`left:${selection.x/source.width*100}%;top:${selection.y/source.height*100}%;width:${selection.w/source.width*100}%;height:${selection.h/source.height*100}%`;d.querySelector('.ca-crop-size').textContent=`選択範囲 ${selection.w}×${selection.h}px`;apply.disabled=selection.w<32||selection.h<32;}else{apply.disabled=true;d.querySelector('.ca-crop-size').textContent='範囲を指定してください（32×32px以上）';}};
   source.addEventListener('pointerdown',e=>{if(own!==epoch||frame!==source)return;e.preventDefault();startPoint=point(e);source.setPointerCapture(e.pointerId);selection=null;show();});
   source.addEventListener('pointermove',e=>{if(!startPoint||own!==epoch)return;e.preventDefault();selection=cropRect(startPoint,point(e),source.width,source.height);show();});
   source.addEventListener('pointerup',e=>{if(!startPoint||own!==epoch)return;e.preventDefault();selection=cropRect(startPoint,point(e),source.width,source.height);startPoint=null;show();});source.addEventListener('pointercancel',()=>{startPoint=null;selection=null;show();});
   const cancel=()=>{clear();status('範囲読み取りをキャンセルしました。画像は送信・保存していません。');};
   d.querySelector('[data-capture="cancel"]').addEventListener('click',cancel);d.addEventListener('cancel',e=>{e.preventDefault();cancel();});d.addEventListener('close',()=>{if(dialog===d)cancel();});d.querySelector('[data-capture="reset"]').addEventListener('click',()=>{selection=null;startPoint=null;show();});
   apply.addEventListener('click',async()=>{
    if(!selection||selection.w<32||selection.h<32||own!==epoch)return;apply.disabled=true;
    const r={...selection},out=document.createElement('canvas'),scale=Math.min(1,1600/Math.max(r.w,r.h));out.width=Math.max(32,Math.round(r.w*scale));out.height=Math.max(32,Math.round(r.h*scale));out.getContext('2d').drawImage(source,r.x,r.y,r.w,r.h,0,0,out.width,out.height);
    discard(); // Destroy full-screen pixels; only the cropped bitmap survives.
    try{let blob=await new Promise(resolve=>out.toBlob(resolve,'image/png'));while(blob&&blob.size>5*1024*1024&&Math.max(out.width,out.height)>640){const tmp=document.createElement('canvas');tmp.width=Math.max(32,Math.floor(out.width*.8));tmp.height=Math.max(32,Math.floor(out.height*.8));tmp.getContext('2d').drawImage(out,0,0,tmp.width,tmp.height);out.width=tmp.width;out.height=tmp.height;out.getContext('2d').drawImage(tmp,0,0);blob=await new Promise(resolve=>out.toBlob(resolve,'image/png'));tmp.width=tmp.height=1;}if(own!==epoch)return;if(!blob||blob.size>5*1024*1024)throw new Error('size');await onCrop(new File([blob],'画面の選択範囲.png',{type:'image/png'}));}
    catch{if(own===epoch)status('切り抜きを作成できませんでした。小さな範囲を選び直すか、画像添付をご利用ください。');}
    finally{out.width=out.height=1;if(own===epoch){active=false;onChange();}}
   });d.showModal();
  }
  window.addEventListener('pagehide',clear);
  return {start,choose,startLocal,clear,supported,busy:()=>active};
 }};
})();
