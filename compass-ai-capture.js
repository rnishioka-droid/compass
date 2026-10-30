/* One user-authorized frame, local crop only. No network, recorder or storage. */
(()=>{
 'use strict';
 function cropRect(a,b,w,h){const x=Math.max(0,Math.min(w,Math.round(Math.min(a.x,b.x)))),y=Math.max(0,Math.min(h,Math.round(Math.min(a.y,b.y))));const right=Math.max(x,Math.min(w,Math.round(Math.max(a.x,b.x)))),bottom=Math.max(y,Math.min(h,Math.round(Math.max(a.y,b.y))));return {x,y,w:right-x,h:bottom-y};}
 function captureError(error){switch(error?.name){case 'NotAllowedError':case 'SecurityError':return '画面共有がキャンセルされたか、許可されませんでした。画像添付・貼り付けも利用できます。';case 'NotFoundError':return '取得できる画面が見つかりません。対象のタブ・ウィンドウを開いてください。';case 'OverconstrainedError':return '取得画面が大きすぎます。対象のウィンドウを小さくするか、単一のタブを選択してください。';case 'NotReadableError':return '画面を取得できません。OSの画面収録権限や対象ウィンドウを確認してください。';case 'InvalidStateError':return 'COMPASSに戻り、「範囲を読み取る」を直接クリックしてください。';case 'AbortError':return '画面共有が終了しました。画像は送信していません。';case 'NotSupportedError':case 'TypeError':return 'この環境では画面取得を利用できません。画像添付・貼り付けをご利用ください。';default:return '画面を取得できませんでした。画像は送信していません。画像添付・貼り付けも利用できます。';}}
 if(typeof module!=='undefined')module.exports={cropRect,captureError};if(typeof window==='undefined')return;
 window.CompassScreenCapture={create(root,{onChange,status,isBusy,getCount,onCrop}){
  let active=false,epoch=0,stream=null,video=null,frame=null,dialog=null,cancelFrame=null;
  const supported=()=>Boolean(window.isSecureContext&&navigator.mediaDevices?.getDisplayMedia&&!/Android|iPhone|iPad|iPod/.test(navigator.userAgent)&&!(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1));
  function stop(){for(const track of stream?.getTracks()||[])try{track.stop();}catch{}stream=null;if(video){video.pause();video.srcObject=null;video.remove();video=null;}}
  function discard(){if(frame){frame.width=frame.height=1;frame=null;}if(dialog){const d=dialog;dialog=null;if(d.open)d.close();d.remove();}}
  function clear(){epoch++;cancelFrame?.();cancelFrame=null;stop();discard();active=false;onChange();}
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
  return {start,clear,supported,busy:()=>active};
 }};
})();
