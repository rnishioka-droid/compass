/* Conversation stays in memory; this module never reads COMPASS business records. */
(() => {
  "use strict";
  const adapter=window.CompassAIAdapter;if(!adapter)return;
  const root=document.createElement("aside");root.id="compassAi";root.hidden=true;root.setAttribute("aria-label","コンパスくん AI文章作成");
  root.innerHTML=`<button class="ca-launch" type="button" aria-label="コンパスくんを開く" aria-expanded="false" aria-controls="compassAiPanel"><img src="./assets/compass-kun.png" alt=""><span>コンパスくん</span></button>
  <section class="ca-panel" id="compassAiPanel" aria-label="コンパスくんチャット" hidden>
  <header class="ca-head"><img src="./assets/compass-kun.png" alt=""><strong>コンパスくん</strong><button type="button" class="ca-new">新しい会話</button><button type="button" class="ca-close" aria-label="チャットを閉じる">閉じる</button></header>
  <div class="ca-body"><p class="ca-greeting">こんにちは！推薦文や求人票づくりをお手伝いします。「〇〇ホームの求人票を作って」のように施設名だけでもネット検索できます。公式求人URLでも確認できます。</p>
  <div class="ca-modes"><button type="button" data-mode="recommendation">推薦文を作成</button><button type="button" data-mode="job">求人票を作成</button></div>
  <div class="ca-log" role="log" aria-label="文章作成の会話" aria-live="polite"></div>
  <details class="ca-privacy"><summary>OpenAIへ送る匿名の業務情報</summary><pre>登録データは参照しません。入力原文はそのまま送信しません。</pre></details><div class="ca-attachments" hidden></div><p class="ca-status" role="status"></p></div>
  <form class="ca-compose"><div class="ca-input-tools"><button class="ca-capture" type="button">範囲を読み取る</button><button class="ca-attach" type="button">画像を添付</button></div><small class="ca-capture-fallback" hidden>この端末では画像添付・貼り付けをご利用ください。</small><input class="ca-file" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden><textarea aria-label="コンパスくんへの指示" maxlength="2000" placeholder="文章を入力／範囲読み取り・画像添付も使えます"></textarea>
  <label class="ca-consent"><input type="checkbox"><span>匿名の業務情報・確認済み画像をOpenAIへ送り、検索時は公開施設名・地域・職種等をBraveへ送ることに同意する</span></label>
  <div class="ca-actions"><small>氏名・連絡先は不要です。会話・下書きはDBへ保存しません。</small><button class="ca-send" type="submit">送信</button></div></form>
  <footer class="ca-budget" aria-live="polite">4名共有のAI予算を確認します</footer><div class="ca-testing" hidden><button type="button" class="ca-test">架空データで接続確認（上限20円相当）</button></div></section>`;
  document.body.append(root);const $=s=>root.querySelector(s),launcher=$(".ca-launch"),panel=$(".ca-panel"),input=$("textarea");
  let history=[],state=null,usage=null,busy=false,session="",epoch=0,dockFrame=0,imageEditor=null,screenCapture=null;
  const status=text=>{$(".ca-status").textContent=text;};
  const money=n=>Number(n||0).toLocaleString("ja-JP",{maximumFractionDigits:2});
  function controls(){
    const capturing=Boolean(screenCapture?.busy());
    $(".ca-send").disabled=busy||capturing||!usage?.configured||usage?.blocked||!$(".ca-consent input").checked||(imageEditor?!imageEditor.ready():false);
    $(".ca-send").textContent=busy?"考えています…":"送信";$(".ca-new").disabled=busy||capturing;$(".ca-test").disabled=busy||capturing||history.length>0;
    root.querySelectorAll("[data-mode]").forEach(b=>{b.disabled=busy||capturing;});
    $(".ca-attach").disabled=busy||capturing||!imageEditor;imageEditor?.setBusy(busy||capturing);
    $(".ca-capture").disabled=busy||capturing||!screenCapture?.supported();$(".ca-capture-fallback").hidden=Boolean(screenCapture?.supported());
  }
  if(window.CompassImageEditor)imageEditor=window.CompassImageEditor.create($(".ca-attachments"),{onChange:controls,status:text=>status(text),isBusy:()=>busy});
  if(window.CompassScreenCapture&&imageEditor)screenCapture=window.CompassScreenCapture.create(root,{onChange:controls,status:text=>status(text),isBusy:()=>busy,getCount:()=>imageEditor.count(),onCrop:file=>imageEditor.add([file],{revealCropped:true})});
  $(".ca-capture").addEventListener("click",()=>screenCapture?.start());
  $(".ca-attach").addEventListener("click",()=>{if(!busy)$(".ca-file").click();});
  $(".ca-file").addEventListener("change",e=>{imageEditor?.add(e.target.files);e.target.value="";});
  root.addEventListener("paste",e=>{const files=[...(e.clipboardData?.items||[])].filter(x=>x.kind==="file"&&x.type.startsWith("image/")).map(x=>x.getAsFile()).filter(Boolean);if(files.length){e.preventDefault();e.stopPropagation();if(!screenCapture?.busy())imageEditor?.add(files);}});
  root.addEventListener("dragover",e=>{if([...(e.dataTransfer?.types||[])].includes("Files")){e.preventDefault();e.stopPropagation();root.classList.add("ca-drag");}});
  root.addEventListener("dragleave",e=>{if(!root.contains(e.relatedTarget))root.classList.remove("ca-drag");});
  root.addEventListener("drop",e=>{if(e.dataTransfer?.files.length){e.preventDefault();e.stopPropagation();root.classList.remove("ca-drag");if(!screenCapture?.busy())imageEditor?.add(e.dataTransfer.files);}});
  function displayUsage(value){usage=value;$(".ca-testing").hidden=!value.smokeTestEnabled||!value.configured;
    $(".ca-budget").textContent=`${value.month}・4名共有 概算${money(value.spentJpy)}円 / ${money(value.budgetJpy)}円（予約 ${money(value.reservedJpy)}円）${value.warning?"・予算残額にご注意ください":""}${value.blocked?"・今月の生成停止":""}`;
    $(".ca-budget").dataset.warning=String(value.warning||value.blocked);$(".ca-budget").title=`安全停止額 ${money(value.stopJpy)}円`;
    if(!value.configured)status("AIは停止中です。管理者の確認後にご利用ください。");else if(!imageEditor)status("画像機能を読み込めませんでした。文字入力は利用できます。画像を使う場合は8ファイルの反映と再読み込みを確認してください。");controls();}
  const errorMessage=e=>e?.details?.code?.startsWith("AI_")?e.message:"通信結果を確認できません。自動再送はしていません。利用状況を確認してください。";
  async function loadUsage(){const current=epoch;try{const r=await adapter.request("/api/ai/usage",{method:"GET"});if(checkSession()&&current===epoch)displayUsage(r);}catch(e){if(current===epoch){usage=null;status(errorMessage(e));controls();}}}
  function addMessage(role,text,copy=false,sources=[],pictures=[]){
    const box=document.createElement("article");box.className="ca-message";box.dataset.role=role;const p=document.createElement("p");p.textContent=text;box.append(p);
    const urls=sources.filter(s=>{try{return new URL(s.url).protocol==="https:";}catch{return false;}});
    for(const source of urls){const a=document.createElement("a");a.href=source.url;a.target="_blank";a.rel="noopener noreferrer";a.textContent=`参照：${source.title||new URL(source.url).hostname}`;a.className="ca-citation";box.append(a);}
    if(copy){const button=document.createElement("button");button.type="button";button.className="ca-copy";button.textContent="コピー";button.addEventListener("click",async()=>{const full=text+(urls.length?"\n\n参照元：\n"+urls.map(s=>s.url).join("\n"):"");try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(full);else{const t=document.createElement("textarea");t.value=full;t.style.cssText="position:fixed;opacity:0";root.append(t);t.select();const ok=document.execCommand("copy");t.remove();if(!ok)throw new Error();}button.textContent="コピー済み";}catch{button.textContent="コピーできませんでした";}});box.append(button);}
    for(const pic of pictures){const thumb=document.createElement("img");thumb.src=pic.dataUrl;thumb.alt="送信した加工済み画像";thumb.className="ca-sent-image";thumb.addEventListener("click",()=>thumb.classList.toggle("ca-enlarge"));box.append(thumb);}
    $(".ca-log").append(box);box.scrollIntoView({block:"nearest"});}
  function reset(){epoch++;history=[];state=usage=null;busy=false;screenCapture?.clear();imageEditor?.clear();$(".ca-log").replaceChildren();input.value="";$(".ca-consent input").checked=false;$(".ca-privacy pre").textContent="登録データは参照しません。入力原文はそのまま送信しません。";$(".ca-testing").hidden=true;status("");controls();}
  function checkSession(){const next=adapter.session();if(next!==session){session=next;reset();panel.hidden=true;launcher.hidden=false;launcher.setAttribute("aria-expanded","false");}root.hidden=!session;return Boolean(session);}
  function open(){if(!checkSession())return;panel.hidden=false;launcher.hidden=true;launcher.setAttribute("aria-expanded","true");loadUsage();scheduleDock();input.focus();}
  function close(){screenCapture?.clear();panel.hidden=true;launcher.hidden=false;launcher.setAttribute("aria-expanded","false");scheduleDock();launcher.focus();}
  root.addEventListener("click",e=>e.stopPropagation());root.addEventListener("change",e=>e.stopPropagation());root.addEventListener("keydown",e=>{if(e.key==="Escape"){e.stopPropagation();if(screenCapture?.busy()){e.preventDefault();screenCapture.clear();status("範囲読み取りをキャンセルしました。画像は送信していません。");}else close();}});
  launcher.addEventListener("click",open);$(".ca-close").addEventListener("click",close);$(".ca-consent input").addEventListener("change",controls);
  $(".ca-new").addEventListener("click",()=>{if(!history.length||confirm("必要な文章はコピーしてください。新しい会話を始めますか？")){reset();loadUsage();input.focus();}});
  root.querySelectorAll("[data-mode]").forEach(b=>b.addEventListener("click",()=>{if(busy)return;const job=b.dataset.mode==="job";const text=job?"求人票を作成したいです。":"推薦文を作成したいです。";history.push({role:"user",content:text});addMessage("user",text);addMessage("assistant",job?"募集職種や給与・勤務時間などを教えてください。分かる条件や公式求人URLがあれば、そのまま入力してください。":"資格やこれまでの業務・経験年数、希望する働き方を教えてください。氏名や連絡先は不要です。");input.focus();}));
  $(".ca-compose").addEventListener("submit",async e=>{
    e.preventDefault();e.stopPropagation();if(!checkSession()||busy||$(".ca-send").disabled||(!input.value.trim()&&!imageEditor?.count()))return;
    let pictures;try{pictures=imageEditor?.payload()||[];}catch(error){status(error.message);return;}
    if(pictures.length){const hint=history.at(-1);history=hint?.role==="user"&&/^(?:求人票|推薦文)を作成したいです。?$/.test(hint.content)?[hint]:[];state=null;}
    const text=input.value.trim()||(pictures.length?"この画像の業務情報から文章を作成してください。":""),current=epoch;busy=true;controls();status(pictures.length?"確認済み画像を送信・読取しています…":"内容を確認しています…");addMessage("user",text,false,[],pictures);input.value="";imageEditor?.clear();
    const prior=history.slice(-8).map(x=>({...x}));while(prior.reduce((n,x)=>n+x.content.length,0)>12000)prior.splice(0,2);
    try{const r=await adapter.request("/api/ai/generate",{method:"POST",body:{requestId:crypto.randomUUID(),consent:true,message:text,history:prior,...(state?{state}:{}),...(pictures.length?{images:pictures}:{})}});
      if(!checkSession()||current!==epoch)return;state=r.state||state;history.push({role:"user",content:text},{role:"assistant",content:r.text,seal:r.seal});history=history.slice(-8);
      addMessage("assistant",r.text,true,r.sources||[]);displayUsage(r.usage);$(".ca-privacy pre").textContent=Object.entries(r.privacyFacts||{}).map(([k,v])=>`${k}：${v}`).join("\n")||"まだ送信できる業務情報がありません。質問への補足をお願いします。";
      status(r.vision?(r.vision.privacyRisk?"画像の個人情報マスクを再確認してください。":`画像${r.vision.imagesRead}枚を読取りました。${r.vision.uncertain.length?"不鮮明："+r.vision.uncertain.join("、"):"内容を確認し、会話で修正できます。"}`):r.metering?.searchCalls?(r.local?"検索1回分を共有予算に計上しました。AI生成は行っていません。":"検索・AI生成を共有予算に計上しました。施設・募集条件と参照元を確認してください。"):r.local?"会話・確認済み情報を引き継いでいます。外部AIの費用は発生していません。":r.incomplete?"出力上限に達しました。続きを依頼できます。":"下書きです。内容と参照元を確認し、会話で修正できます。");
    }catch(error){if(current===epoch){status(errorMessage(error));await loadUsage();}}
    finally{if(current===epoch){busy=false;controls();input.focus();}}
  });
  $(".ca-test").addEventListener("click",async()=>{if(busy||history.length)return;const current=epoch;busy=true;controls();try{const plan=await adapter.request("/api/ai/smoke-test",{method:"GET"});if(!plan.canRun){status("テスト予算が不足しています。");return;}if(!confirm(`架空データ3件で接続確認します。最大見積り${money(plan.estimatedMaxJpy)}円。共有予算にも計上します。実行しますか？`))return;for(const caseId of plan.cases){const r=await adapter.request("/api/ai/smoke-test",{method:"POST",body:{caseId,requestId:crypto.randomUUID(),consent:true}});if(!checkSession()||current!==epoch)return;addMessage("assistant",r.text,true);displayUsage(r.usage);if(r.incomplete)break;}}catch(e){if(current===epoch)status(errorMessage(e));}finally{if(current===epoch){busy=false;controls();}}});
  function scheduleDock(){if(!dockFrame)dockFrame=requestAnimationFrame(dock);}
  function dock(){dockFrame=0;if(root.hidden)return;let right=innerWidth<=600?12:16,bottom=innerWidth<=600?12:16;
    const drawer=document.getElementById("drawerBackdrop"),pane=drawer?.classList.contains("open")?drawer.querySelector(".drawer"):null;
    if(pane&&innerWidth>900){const left=pane.getBoundingClientRect().left;if(left>(panel.hidden?90:410)+30)right=innerWidth-left+12;}
    root.style.right=`${right}px`;root.style.bottom=`${bottom}px`;if(!panel.hidden)return;
    for(let i=0;i<8;i++){const r=launcher.getBoundingClientRect();if(r.top<100||!document.elementsFromPoint(r.left+r.width/2,r.top+r.height/2).some(el=>!root.contains(el)&&el.closest("button,input,select,textarea,a")))break;bottom+=50;root.style.bottom=`${bottom}px`;}}
  // Compatibility no-op: list/detail navigation can no longer provide a target.
  window.CompassAI={setContext(){scheduleDock();}};
  new MutationObserver(records=>{if(records.some(r=>!root.contains(r.target))){checkSession();scheduleDock();}}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:["class","hidden","aria-hidden"]});
  window.addEventListener("resize",scheduleDock);window.addEventListener("scroll",scheduleDock,{passive:true,capture:true});window.addEventListener("storage",checkSession);setInterval(checkSession,15000);checkSession();scheduleDock();
})();
