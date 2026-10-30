/* Local-only masking. No OCR, network, storage, or original-image upload. */
(()=>{
 "use strict";
 function dimensions(bytes,type){
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),s=(at,n)=>String.fromCharCode(...bytes.slice(at,at+n));
  if(type==='image/png'&&bytes.length>=24&&s(1,3)==='PNG')return [v.getUint32(16),v.getUint32(20)];
  if(type==='image/jpeg'&&bytes[0]===255&&bytes[1]===216){let at=2;while(at+4<bytes.length){if(bytes[at++]!==255)continue;while(bytes[at]===255)at++;const marker=bytes[at++];if(marker===0xda||marker===0xd9)break;if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;const len=v.getUint16(at);if(len<2||at+len>bytes.length)break;if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&len>=7)return [v.getUint16(at+5),v.getUint16(at+3)];at+=len;}}
  if(type==='image/webp'&&bytes.length>=30&&s(0,4)==='RIFF'&&s(8,4)==='WEBP'){
   if(s(12,4)==='VP8X')return [1+bytes[24]+bytes[25]*256+bytes[26]*65536,1+bytes[27]+bytes[28]*256+bytes[29]*65536];
   if(s(12,4)==='VP8L'&&bytes[20]===0x2f){const b=v.getUint32(21,true);return [(b&0x3fff)+1,((b>>>14)&0x3fff)+1];}
   if(s(12,4)==='VP8 '&&bytes[23]===0x9d&&bytes[24]===1&&bytes[25]===0x2a)return [v.getUint16(26,true)&0x3fff,v.getUint16(28,true)&0x3fff];
  }
  throw Error('PNG・JPEG・WebPの静止画像を選択してください。');
 }
 if(typeof module!=='undefined')module.exports={dimensions};
 if(typeof window==='undefined')return;
 window.CompassImageEditor={create(host,{onChange,status,isBusy}){
  let items=[],loading=0,generation=0,dragMode='reveal';
  function invalidate(item){item.data=null;item.reviewed=false;item.preview.hidden=true;item.check.checked=false;item.check.disabled=true;onChange();}
  function render(item){const c=item.canvas,x=c.getContext('2d');x.fillStyle='#000';x.fillRect(0,0,c.width,c.height);for(const r of item.rects){if(r.hide){x.fillStyle='#000';x.fillRect(r.x,r.y,r.w,r.h);}else{x.save();x.beginPath();x.rect(r.x,r.y,r.w,r.h);x.clip();x.drawImage(item.original,0,0,c.width,c.height);x.restore();}}}
  function point(e,canvas){const r=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(canvas.width,(e.clientX-r.left)*canvas.width/r.width)),y:Math.max(0,Math.min(canvas.height,(e.clientY-r.top)*canvas.height/r.height))};}
  function dispose(item){item.dialog?.close();item.dialog?.remove();URL.revokeObjectURL(item.url);item.original.src='';item.canvas.width=item.canvas.height=1;item.data=null;item.preview.removeAttribute('src');item.card.remove();}
  function notify(){host.hidden=!items.length&&!loading;onChange();}
  async function add(files,{revealCropped=false}={}){
   if(isBusy())return;const epoch=generation;
   for(const file of Array.from(files)){
    if(items.length+loading>=2){status('画像は1回に2枚までです。');break;}
    loading++;notify();let url=null;
    try{
     if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024||file.size===0)throw Error('PNG・JPEG・WebP、各5MB以下の画像を選択してください。');
     const [w,h]=dimensions(new Uint8Array(await file.arrayBuffer()),file.type);if(w<32||h<32||w>8000||h>8000||w*h>16000000)throw Error('元画像は最大8000px、合計1600万画素までです。スクショを切り分けてください。');
     if(epoch!==generation)continue;url=URL.createObjectURL(file);const original=new Image();original.src=url;await original.decode();if(epoch!==generation){URL.revokeObjectURL(url);continue;}
     const scale=Math.min(1,1600/Math.max(original.naturalWidth,original.naturalHeight));
     const card=document.createElement('section');card.className='ca-image-card';card.innerHTML=`<strong>画像の送信範囲</strong><p>最初は全体が黒塗りです。資格・職歴・勤務条件など、送ってよい範囲だけドラッグして表示してください。氏名・住所・電話・メール・生年月日・顔写真は表示しないでください。</p><div class="ca-mask-tools"><button type="button" data-tool="reveal">業務範囲を表示</button><button type="button" data-tool="hide">黒塗り</button><button type="button" data-tool="original">元画像を端末内で確認</button><button type="button" data-tool="reset">すべて隠す</button><button type="button" data-tool="remove">削除</button></div><canvas aria-label="送信範囲の編集" tabindex="0"></canvas><button type="button" data-tool="export">送信用プレビューを作成</button><img class="ca-image-preview" alt="実際に送信する加工済み画像" hidden><label class="ca-image-review"><input type="checkbox" disabled><span>この送信画像に個人情報がないこと、利用権限と適切な同意があることを確認しました。不明な範囲は送信しません。</span></label>`;
     const canvas=card.querySelector('canvas');canvas.width=Math.max(32,Math.round(original.naturalWidth*scale));canvas.height=Math.max(32,Math.round(original.naturalHeight*scale));
     const item={card,canvas,original,url,rects:revealCropped?[{x:0,y:0,w:canvas.width,h:canvas.height,hide:false}]:[],data:null,reviewed:false,check:card.querySelector('input'),preview:card.querySelector('img')};if(revealCropped){card.querySelector('strong').textContent='取り込んだ範囲の確認';card.querySelector('p').textContent='取り込んだ画像を端末内で表示しています。貼り付け画像は範囲外の情報も含まれていないか確認してください。氏名・住所・連絡先・生年月日・顔写真などが残っていれば「黒塗り」で隠し、送信用プレビューを確認してください。';}items.push(item);host.append(card);url=null;
     item.preview.tabIndex=0;item.preview.setAttribute('role','button');item.preview.setAttribute('aria-label','送信画像を拡大確認');
     function zoom(raw=false){if(!raw&&!item.data)return;const dialog=document.createElement('dialog');dialog.className='ca-image-zoom';dialog.innerHTML='<button type="button">プレビューを閉じる</button><p>個人情報が残っていないか、スクロールして全体を確認してください。</p><img alt="送信画像の拡大プレビュー">';if(raw)dialog.querySelector('p').textContent='元画像：この表示は端末内だけです。送信には使いません。業務欄の位置を確認し、閉じて表示範囲を指定してください。';dialog.querySelector('img').src=raw?item.url:item.data.dataUrl;dialog.querySelector('button').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>dialog.remove());host.closest('#compassAi').append(dialog);item.dialog=dialog;dialog.showModal();}
     item.preview.addEventListener('click',()=>zoom());item.preview.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();zoom();}});
     let start=null;
     canvas.addEventListener('pointerdown',e=>{if(isBusy())return;e.preventDefault();start=point(e,canvas);canvas.setPointerCapture(e.pointerId);invalidate(item);});
     canvas.addEventListener('pointerup',e=>{if(!start||isBusy())return;e.preventDefault();const end=point(e,canvas),r={x:Math.round(Math.min(start.x,end.x)),y:Math.round(Math.min(start.y,end.y)),w:Math.round(Math.abs(end.x-start.x)),h:Math.round(Math.abs(end.y-start.y)),hide:dragMode==='hide'};start=null;if(r.w<3||r.h<3){status('範囲をドラッグして指定してください。');return;}if(item.rects.length>=40){status('1枚につき編集範囲は40個までです。');return;}item.rects.push(r);invalidate(item);render(item);});
     canvas.addEventListener('pointercancel',()=>{start=null;});
     card.querySelectorAll('[data-tool]').forEach(button=>button.addEventListener('click',()=>{
      if(isBusy())return;const tool=button.dataset.tool;
      if(tool==='original'){zoom(true);return;}
      if(tool==='remove'){items=items.filter(x=>x!==item);dispose(item);notify();return;}
      if(tool==='reveal'||tool==='hide'){dragMode=tool;status(tool==='reveal'?'送ってよい業務範囲をドラッグしてください。':'隠す範囲をドラッグしてください。');return;}
      if(tool==='reset'){item.rects=[];invalidate(item);render(item);return;}
      if(!item.rects.some(r=>!r.hide)){status('送信してよい業務範囲を先に指定してください。');return;}
      try{render(item);const out=document.createElement('canvas');out.width=canvas.width;out.height=canvas.height;out.getContext('2d').drawImage(canvas,0,0);let data=out.toDataURL('image/png');
       while((data.length-22)*.75>750000&&Math.max(out.width,out.height)>640){const tmp=document.createElement('canvas');tmp.width=Math.max(32,Math.floor(out.width*.8));tmp.height=Math.max(32,Math.floor(out.height*.8));tmp.getContext('2d').drawImage(out,0,0,tmp.width,tmp.height);out.width=tmp.width;out.height=tmp.height;out.getContext('2d').drawImage(tmp,0,0);data=out.toDataURL('image/png');}
       if((data.length-22)*.75>750000)throw Error('加工後の画像が750KBを超えます。元画像を切り分けてください。');
       item.data={dataUrl:data,width:out.width,height:out.height,processed:'masked-canvas-v1',regionCount:item.rects.length};item.preview.src=data;item.preview.hidden=false;item.check.disabled=false;item.check.checked=false;item.reviewed=false;status('送信用プレビューを拡大して確認し、個人情報がない場合だけ確認欄にチェックしてください。');onChange();
      }catch(e){status(e.message);}
     }));
     item.check.addEventListener('change',()=>{item.reviewed=Boolean(item.data&&item.check.checked);onChange();});render(item);status(revealCropped?'取り込んだ範囲を表示しました。必要な黒塗りを行い、送信用プレビューを確認してください。':'画像はまだ送信されません。送る業務範囲を指定し、プレビューを確認してください。');
    }catch(e){if(url)URL.revokeObjectURL(url);status(e.message||'画像を読み込めません。');}
    finally{loading--;notify();}
   }
  }
  return {add,count:()=>items.length,ready:()=>!loading&&items.every(i=>i.reviewed&&i.data),payload:()=>{if(loading||items.some(i=>!i.reviewed||!i.data))throw Error('全画像の送信範囲と個人情報を確認してください。');return items.map(i=>({...i.data,reviewed:true,privacyConsent:true}));},clear(){generation++;for(const i of items)dispose(i);items=[];notify();},setBusy(value){host.querySelectorAll('button,input').forEach(el=>{el.disabled=value||el.type==='checkbox'&&!items.find(i=>i.check===el)?.data;});}};
 }};
})();
