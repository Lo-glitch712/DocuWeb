const $=id=>document.getElementById(id); const W=940,H=788;
const canvas=$('canvas'),ctx=canvas.getContext('2d',{alpha:false});
let photos=[],selected=-1,overlay=null,overlayURL=null,stream=null,camFacing='environment',cameraTrack=null;

/* --- Persistent local photo storage (IndexedDB) --- */
const DB_NAME='docuframe_local_v2', DB_VER=1, PHOTO_STORE='photos', SETTINGS_STORE='settings';
let db=null;
async function dbPutSetting(key,value){
  try{ const d=await openPhotoDB(); await new Promise((res,rej)=>{ const tx=d.transaction(SETTINGS_STORE,'readwrite'); tx.objectStore(SETTINGS_STORE).put({key,value}); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); }); }catch(e){ console.warn('Setting persistence failed',e); }
}
async function dbGetSetting(key){
  try{ const d=await openPhotoDB(); return await new Promise((res,rej)=>{ const tx=d.transaction(SETTINGS_STORE,'readonly'); const r=tx.objectStore(SETTINGS_STORE).get(key); r.onsuccess=()=>res(r.result?.value ?? null); r.onerror=()=>rej(r.error); }); }catch(e){ console.warn('Setting restore failed',e); return null; }
}
async function restoreAppSettings(){
  try{
    const savedOverlay=await dbGetSetting('overlay');
    if(savedOverlay){ overlay=await loadImage(savedOverlay.blob); overlayURL=URL.createObjectURL(savedOverlay.blob); $('templatePreview').src=overlayURL; }
    const savedProject=await dbGetSetting('project');
    const savedCustom=await dbGetSetting('custom');
    if(savedProject!==null) $('project').value=savedProject;
    if(savedCustom!==null) $('custom').value=savedCustom;
    drawPreview();
  }catch(e){ console.warn('App settings restore failed',e); }
}
function openPhotoDB(){
  if(db) return Promise.resolve(db);
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VER);
    req.onupgradeneeded=()=>{ const d=req.result; if(!d.objectStoreNames.contains(PHOTO_STORE)){ const st=d.createObjectStore(PHOTO_STORE,{keyPath:'id'}); st.createIndex('addedAt','addedAt'); } if(!d.objectStoreNames.contains(SETTINGS_STORE)){ d.createObjectStore(SETTINGS_STORE,{keyPath:'key'}); } };
    req.onsuccess=()=>{ db=req.result; resolve(db); };
    req.onerror=()=>reject(req.error);
  });
}
async function dbPutPhoto(p){
  try{ const d=await openPhotoDB(); await new Promise((res,rej)=>{ const tx=d.transaction(PHOTO_STORE,'readwrite'); tx.objectStore(PHOTO_STORE).put({id:p.id,blob:p.file,name:p.name,width:p.width,height:p.height,addedAt:p.addedAt,e:p.e}); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); }); }catch(e){ console.warn('Photo persistence failed',e); }
}
async function dbDeletePhoto(id){
  try{ const d=await openPhotoDB(); await new Promise((res,rej)=>{ const tx=d.transaction(PHOTO_STORE,'readwrite'); tx.objectStore(PHOTO_STORE).delete(id); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); }); }catch(e){ console.warn('Photo delete persistence failed',e); }
}
async function dbLoadPhotos(){
  try{
    const d=await openPhotoDB();
    const rows=await new Promise((res,rej)=>{ const tx=d.transaction(PHOTO_STORE,'readonly'); const r=tx.objectStore(PHOTO_STORE).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); });
    rows.sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));
    photos=[];
    for(const row of rows){ const blob=row.blob; photos.push({id:row.id,file:blob,name:row.name,url:URL.createObjectURL(blob),width:row.width,height:row.height,addedAt:row.addedAt,e:row.e||{z:1,x:0,y:0,r:0,b:1,c:1}}); }
    renderList();
    if(photos.length){ selected=0; select(0); $('status').textContent=`${photos.length} saved photo${photos.length>1?'s':''} restored · newest first`; }
    else { $('status').textContent='Ready · photos are saved on this device'; }
  }catch(e){ console.warn('Photo restore failed',e); $('status').textContent='Ready · local photo storage unavailable'; }
}

function toast(msg){const t=$('toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.add('hidden'),2200)}
function loadImage(fileOrUrl){return new Promise((resolve,reject)=>{const url=typeof fileOrUrl==='string'?fileOrUrl:URL.createObjectURL(fileOrUrl);const im=new Image();im.onload=()=>{if(typeof fileOrUrl!=='string')URL.revokeObjectURL(url);resolve(im)};im.onerror=()=>{if(typeof fileOrUrl!=='string')URL.revokeObjectURL(url);reject(new Error('decode'))};im.src=url})}
function renderList(){ $('count').textContent=photos.length; if(!photos.length){$('photos').innerHTML='<div class="empty">No photos yet</div>';return} $('photos').innerHTML=''; photos.forEach((p,i)=>{const d=document.createElement('div');d.className='photo '+(i===selected?'active':'');const im=document.createElement('img');im.src=p.url;const box=document.createElement('div'),b=document.createElement('b'),sm=document.createElement('small');b.textContent=p.name;sm.textContent=`${i+1} · ${p.width}×${p.height}`;box.append(b,sm);d.append(im,box);d.onclick=()=>select(i);$('photos').append(d)})}
async function addFiles(list){
  let added=0;
  const now=Date.now();
  for(const file of list){
    if(!file.type.startsWith('image/')&&!/\.(png|jpe?g|webp|heic|heif|dng|raw)$/i.test(file.name))continue;
    try{
      const im=await loadImage(file);
      const rec={id:crypto.randomUUID?crypto.randomUUID():`${Date.now()}_${Math.random().toString(36).slice(2)}`,file,name:file.name,url:URL.createObjectURL(file),width:im.naturalWidth,height:im.naturalHeight,addedAt:now+added,e:{z:1,x:0,y:0,r:0,b:1,c:1}}; photos.unshift(rec); await dbPutPhoto(rec);
      added++;
    }catch(e){console.warn('Cannot decode',file.name,e)}
  }
  photos.sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));
  renderList();
  if(added){ selected=0; select(0); }
  $('status').textContent=added?`${added} photo${added>1?'s':''} loaded · newest first`:'No supported images found';
}

$('pick').onclick=()=>{$('files').click()};$('files').addEventListener('change',async e=>{await addFiles([...e.target.files]);e.target.value=''});$('drop').onclick=()=>{$('files').click()};$('drop').ondragover=e=>{e.preventDefault();$('drop').style.background='#eaf2ff'};$('drop').ondragleave=()=>{$('drop').style.background=''};$('drop').ondrop=e=>{e.preventDefault();$('drop').style.background='';addFiles([...e.dataTransfer.files])};
function select(i){if(i<0||i>=photos.length)return;selected=i;const e=photos[i].e; $('zoom').value=e.z;$('x').value=e.x;$('y').value=e.y;$('rot').value=e.r;$('bright').value=e.b;$('contrast').value=e.c;renderList();drawPreview()}
function updateReadouts(){if(selected<0)return;const e=photos[selected].e;$('zv').textContent=Math.round(e.z*100)+'%';$('xv').textContent=e.x;$('yv').textContent=e.y;$('rv').textContent=e.r+'°'}
[['zoom','z'],['x','x'],['y','y'],['rot','r'],['bright','b'],['contrast','c']].forEach(([id,key])=>$(id).addEventListener('input',()=>{if(selected<0)return;photos[selected].e[key]=Number($(id).value);dbPutPhoto(photos[selected]);updateReadouts();drawPreview()}));['project','custom'].forEach(id=>$(id).addEventListener('input',()=>{dbPutSetting(id,$(id).value);drawPreview();}));
async function drawComposition(target,ow,oh){target.clearRect(0,0,ow,oh);target.fillStyle='#202832';target.fillRect(0,0,ow,oh);if(selected<0)return false;const p=photos[selected];let im;try{im=await loadImage(p.file)}catch{return false}const e=p.e,scale=Math.max(ow/im.naturalWidth,oh/im.naturalHeight);target.save();target.translate(ow/2+e.x*(ow/W),oh/2+e.y*(oh/H));target.rotate(e.r*Math.PI/180);target.scale(e.z,e.z);target.filter=`brightness(${e.b}) contrast(${e.c})`;const dw=im.naturalWidth*scale,dh=im.naturalHeight*scale;target.drawImage(im,-dw/2,-dh/2,dw,dh);target.restore();target.filter='none';if(overlay)target.drawImage(overlay,0,0,ow,oh);const project=$('project').value.trim(),custom=$('custom').value.trim();if(project||custom){const s=ow/W;target.fillStyle='#000b';target.fillRect(18*s,(H-58)*s,(W-36)*s,40*s);target.fillStyle='#fff';target.font=`bold ${13*s}px system-ui`;target.fillText(project,30*s,(H-35)*s);target.font=`${10*s}px system-ui`;target.fillText(custom,30*s,(H-19)*s)}return true}
async function drawPreview(){updateReadouts();const ok=await drawComposition(ctx,W,H);$('empty').style.display=(selected>=0&&ok)?'none':'flex'}
function chosenResolution(){const v=$('resolution').value;if(v==='original'&&selected>=0)return [photos[selected].width,photos[selected].height];if(v==='custom')return [Math.max(100,Math.min(12000,parseInt($('customW').value)||1920)),Math.max(100,Math.min(12000,parseInt($('customH').value)||1609))];return v.split('x').map(Number)}
function outputName(){const prefix=($('project').value||'DOC').trim().replace(/[^\w-]+/g,'_')||'DOC';return `${prefix}_${String(selected+1).padStart(3,'0')}.jpg`}
async function exportCurrent(){if(selected<0){toast('Upload/select a photo first.');return}const [ow,oh]=chosenResolution(),out=document.createElement('canvas');out.width=ow;out.height=oh;const octx=out.getContext('2d',{alpha:false});if(!(await drawComposition(octx,ow,oh))){toast('Could not render this photo.');return}out.toBlob(blob=>{if(!blob)return toast('Export failed.');const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=outputName();a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('status').textContent=`Saved ${ow} × ${oh}`;toast(`Saved ${ow} × ${oh} JPG`)},'image/jpeg',.94)}
$('save').onclick=exportCurrent;
async function exportBatchZip(){
  if(!photos.length){toast('No photos to download.');return}
  if(typeof JSZip==='undefined'){toast('ZIP engine unavailable.');return}
  const zip=new JSZip();
  const original=selected;
  const chosen=[...document.querySelectorAll('.gcheck:checked')].map(c=>Number(c.dataset.index));
  const indices=chosen.length?chosen:[...photos.keys()];
  let done=0;
  toast(`Preparing ${indices.length} photo${indices.length>1?'s':''}…`);
  for(const i of indices){
    selected=i;
    const [ow,oh]=chosenResolution();
    const out=document.createElement('canvas'); out.width=ow; out.height=oh;
    const octx=out.getContext('2d',{alpha:false});
    if(await drawComposition(octx,ow,oh)){
      const blob=await new Promise(r=>out.toBlob(r,'image/jpeg',.96));
      if(blob) zip.file(outputName(),blob);
    }
    done++;
  }
  selected=original; if(original>=0) drawPreview();
  const blob=await zip.generateAsync({type:'blob',compression:'STORE',streamFiles:true},m=>{ $('status').textContent=`Zipping ${Math.round(m.percent)}%`; });
  const url=URL.createObjectURL(blob),a=document.createElement('a'); a.href=url; a.download=`${(($('project').value||'DocuFrame').trim().replace(/[^\w-]+/g,'_')||'DocuFrame')}_photos.zip`; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000); toast(`Batch ZIP ready · ${indices.length} photo${indices.length>1?'s':''}`); $('status').textContent=`ZIP exported · ${indices.length} photos`;
}
if($('galleryZip')) $('galleryZip').onclick=exportBatchZip;
$('resolution').onchange=()=>{const c=$('resolution').value==='custom';$('customW').classList.toggle('hidden',!c);$('customH').classList.toggle('hidden',!c);$('times').classList.toggle('hidden',!c)};$('reset').onclick=()=>{if(selected<0)return;photos[selected].e={z:1,x:0,y:0,r:0,b:1,c:1};dbPutPhoto(photos[selected]);select(selected)};
$('tpl').onclick=()=>$('modal').classList.remove('hidden');$('closeTpl').onclick=()=>$('modal').classList.add('hidden');$('templateFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(overlayURL)URL.revokeObjectURL(overlayURL);overlay=await loadImage(f);overlayURL=URL.createObjectURL(f);$('templatePreview').src=overlayURL;await dbPutSetting('overlay',{blob:f,name:f.name});$('modal').classList.add('hidden');drawPreview();renderGallery();toast('Template loaded · saved for all gallery photos')}catch{toast('Template PNG could not be loaded')}};
function stopCamera(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}cameraTrack=null}
function liveDraw(){if($('cameraModal').classList.contains('hidden'))return;const v=$('video'),l=$('live'),x=l.getContext('2d');x.clearRect(0,0,W,H);if(v.videoWidth&&v.videoHeight){const sc=Math.max(W/v.videoWidth,H/v.videoHeight),dw=v.videoWidth*sc,dh=v.videoHeight*sc;x.drawImage(v,(W-dw)/2,(H-dh)/2,dw,dh)}if(overlay)x.drawImage(overlay,0,0,W,H);requestAnimationFrame(liveDraw)}
function cameraSize(){const v=$('cameraResolution').value;if(v==='native'){return [cameraTrack?.getSettings().width||$('video').videoWidth,cameraTrack?.getSettings().height||$('video').videoHeight]}if(v==='custom')return [Math.max(100,parseInt($('camW').value)||1920),Math.max(100,parseInt($('camH').value)||1080)];return v.split('x').map(Number)}
function openGallery(){renderGallery();$('galleryModal').classList.remove('hidden')}
function renderGallery(){
  $('galleryCount').textContent=photos.length;
  const g=$('galleryGrid'); g.innerHTML='';
  if(!photos.length){g.innerHTML='<div class="empty">No photos yet</div>';return}
  photos.forEach((p,i)=>{
    const card=document.createElement('div'); card.className='gitem '+(i===selected?'current':'');
    const cb=document.createElement('input'); cb.type='checkbox'; cb.dataset.index=i; cb.className='gcheck';
    const media=document.createElement('div'); media.className='gmedia';
    const im=document.createElement('img'); im.src=p.url; im.loading='lazy';
    media.append(im);
    if(overlay){ const ov=document.createElement('img'); ov.className='gtemplate'; ov.src=overlayURL; ov.alt=''; ov.draggable=false; media.append(ov); }
    const cap=document.createElement('div'); cap.textContent=`${i+1}. ${p.name}`;
    card.append(cb,media,cap);
    card.onclick=e=>{if(e.target===cb)return; cb.checked=!cb.checked; select(i); card.classList.toggle('checked',cb.checked)};
    cb.onclick=e=>e.stopPropagation(); g.append(card);
  });
}

$('galleryBtn').onclick=()=>openGallery();$('closeGallery').onclick=()=>$('galleryModal').classList.add('hidden');$('selectAll').onclick=()=>{document.querySelectorAll('.gcheck').forEach(c=>c.checked=true)};$('deleteSelected').onclick=async()=>{const ids=[...document.querySelectorAll('.gcheck:checked')].map(c=>Number(c.dataset.index)).sort((a,b)=>b-a);if(!ids.length)return toast('Select photos to delete');for(const i of ids){const rec=photos[i]; if(rec){await dbDeletePhoto(rec.id); URL.revokeObjectURL(rec.url); photos.splice(i,1); if(selected===i)selected=-1; else if(selected>i)selected--;}}if(selected<0&&photos.length)selected=0;renderList();if(selected>=0)select(selected);else drawPreview();renderGallery();toast(`${ids.length} photo${ids.length>1?'s':''} deleted`)};$('editSelected').onclick=()=>{const checks=[...document.querySelectorAll('.gcheck:checked')].map(c=>Number(c.dataset.index));if(checks.length!==1)return toast('Select exactly one photo to edit');select(checks[0]);$('galleryModal').classList.add('hidden');$('status').textContent=`Editing photo ${checks[0]+1}`};
function showInfo(){$('edit').classList.add('hidden');$('info').classList.remove('hidden');$('status').textContent='Info panel'}; $('infoBtn').onclick=showInfo; $('infoNav').onclick=showInfo;
renderList();updateReadouts(); restoreAppSettings(); dbLoadPhotos();

/* --- Camera reliability/mobile fullscreen patch --- */
const cameraModal = $('cameraModal');
const cameraResolution = $('cameraResolution');
const cameraOrientation = $('cameraOrientation');
const camStage = document.querySelector('.camstage');
let focusRing = document.getElementById('focusRing');
if(!focusRing){
  focusRing=document.createElement('div'); focusRing.id='focusRing'; focusRing.className='focus-ring'; camStage.appendChild(focusRing);
}
let cameraNative = true;
let cameraImageCapture = null;

function cameraLockPage(open){
  document.documentElement.classList.toggle('camera-open',open);
  document.body.classList.toggle('camera-open',open);
}
async function enterCameraFullscreen(){
  cameraLockPage(true);
  try{
    if(document.fullscreenElement) return;
    if(document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({navigationUI:'hide'});
  }catch(e){ /* iOS Safari and some embedded browsers do not expose Fullscreen API; fixed 100dvh mode remains */ }
}
async function exitCameraFullscreen(){
  cameraLockPage(false);
  try{ if(document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen(); }catch(e){}
}
function showFocus(x,y){
  focusRing.style.left=x+'px'; focusRing.style.top=y+'px';
  focusRing.classList.remove('show'); void focusRing.offsetWidth; focusRing.classList.add('show');
  clearTimeout(showFocus.t); showFocus.t=setTimeout(()=>focusRing.classList.remove('show'),900);
}
async function focusCamera(ev){
  if(!cameraTrack) return;
  const rect=$('video').getBoundingClientRect();
  const x=ev.clientX-rect.left, y=ev.clientY-rect.top;
  if(x<0||y<0||x>rect.width||y>rect.height) return;
  showFocus(x + $('video').offsetLeft, y + $('video').offsetTop);
  const caps=cameraTrack.getCapabilities ? cameraTrack.getCapabilities() : {};
  try{
    if(caps.focusMode && caps.focusMode.includes('single-shot')){
      await cameraTrack.applyConstraints({advanced:[{focusMode:'single-shot'}]});
    } else if(caps.focusMode && caps.focusMode.includes('continuous')){
      await cameraTrack.applyConstraints({advanced:[{focusMode:'continuous'}]});
    }
  }catch(e){ try{await cameraTrack.applyConstraints({advanced:[{focusMode:'continuous'}]})}catch(_){} }
}
if(camStage){
  camStage.addEventListener('pointerup',e=>{ if(e.pointerType==='touch'||e.pointerType==='mouse') focusCamera(e); });
}
function updateCameraOrientation(){
  const o=cameraOrientation ? cameraOrientation.value : 'auto';
  $('video').style.transform = o==='portrait' ? 'none' : 'none';
}
function populateCameraResolutions(){
  if(!cameraResolution || !cameraTrack) return;
  const caps=cameraTrack.getCapabilities ? cameraTrack.getCapabilities() : {};
  const maxW=caps.width?.max, maxH=caps.height?.max;
  const nativeOpt=cameraResolution.querySelector('option[value="native"]');
  if(nativeOpt) nativeOpt.textContent=maxW&&maxH?`Native / Highest (${maxW} × ${maxH})`:'Native / Highest available';
}

/* Replace camera start with autofocus + selected constraints. */
async function startCameraImproved(){
  stopCamera();
  const desired = cameraResolution?.value || 'native';
  let width=3840,height=2160;
  if(desired!=='native' && desired!=='custom') [width,height]=desired.split('x').map(Number);
  if(desired==='custom'){width=Math.max(100,parseInt($('camW').value)||1920);height=Math.max(100,parseInt($('camH').value)||1080)}
  const orientation=cameraOrientation?.value||'auto';
  if(orientation==='portrait' && width>height) [width,height]=[height,width];
  if(orientation==='landscape' && height>width) [width,height]=[height,width];
  try{
    stream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:camFacing},width:{ideal:width},height:{ideal:height},frameRate:{ideal:30,max:60}},audio:false
    });
    $('video').srcObject=stream;
    cameraTrack=stream.getVideoTracks()[0];
    const caps=cameraTrack.getCapabilities ? cameraTrack.getCapabilities() : {};
    const advanced=[];
    if(caps.focusMode){
      if(caps.focusMode.includes('continuous')) advanced.push({focusMode:'continuous'});
      else if(caps.focusMode.includes('single-shot')) advanced.push({focusMode:'single-shot'});
    }
    if(caps.exposureMode?.includes('continuous')) advanced.push({exposureMode:'continuous'});
    if(caps.whiteBalanceMode?.includes('continuous')) advanced.push({whiteBalanceMode:'continuous'});
    if(advanced.length){try{await cameraTrack.applyConstraints({advanced})}catch(e){}}
    cameraNative = desired==='native';
    cameraImageCapture = ('ImageCapture' in window) ? new ImageCapture(cameraTrack) : null;
    const s=cameraTrack.getSettings();
    $('camQuality').textContent=`Live: ${s.width||$('video').videoWidth||'?'} × ${s.height||$('video').videoHeight||'?'} · Tap preview to focus`;
    populateCameraResolutions(); updateCameraOrientation();
    $('video').setAttribute('autofocus','autofocus');
    try{await $('video').play()}catch(e){}
    liveDraw();
  }catch(e){
    toast(e?.name==='NotAllowedError'?'Allow camera permission, then try again.':'Camera could not start. Use HTTPS/localhost.');
  }
}

/* Rewire handlers */
$('cam').onclick=async()=>{
  clearCameraSessionPreviews();
  await enterCameraFullscreen();
  cameraModal.classList.remove('hidden');
  await startCameraImproved();
};
$('closeCam').onclick=async()=>{ await finishCameraSession(); };
$('switchCam').onclick=async()=>{camFacing=camFacing==='environment'?'user':'environment';await startCameraImproved()};
if(cameraResolution) cameraResolution.onchange=async()=>{
  const c=cameraResolution.value==='custom'; $('camCustom').classList.toggle('hidden',!c);
  if(!cameraModal.classList.contains('hidden')) await startCameraImproved();
};
if(cameraOrientation) cameraOrientation.onchange=async()=>{
  updateCameraOrientation(); if(!cameraModal.classList.contains('hidden')) await startCameraImproved();
};
window.addEventListener('orientationchange',()=>{if(!cameraModal.classList.contains('hidden')) setTimeout(()=>{updateCameraOrientation();liveDraw()},250)});
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement && !cameraModal.classList.contains('hidden')) cameraLockPage(true)});

/* Session capture: in-camera previews with per-shot removal */
let cameraSessionShots = [];
let capturingBurst = false;

async function removeSessionShot(index){
  const shot = cameraSessionShots[index];
  if(!shot) return;
  const photoIndex = photos.findIndex(p => p.id === shot.photoId);
  if(photoIndex >= 0){
    const rec = photos[photoIndex];
    await dbDeletePhoto(rec.id);
    try{ URL.revokeObjectURL(rec.url); }catch(_){}
    photos.splice(photoIndex, 1);
    if(selected === photoIndex) selected = photos.length ? 0 : -1;
    else if(selected > photoIndex) selected--;
    renderList();
    if(selected >= 0) select(selected); else drawPreview();
    renderGallery();
  }
  try{ URL.revokeObjectURL(shot.url); }catch(_){}
  cameraSessionShots.splice(index, 1);
  renderCamPreviews();
  $('camQuality').textContent = cameraSessionShots.length
    ? `${cameraSessionShots.length} shot${cameraSessionShots.length>1?'s':''} in session`
    : 'Shot removed · take another';
  toast('Shot removed');
}

function renderCamPreviews(){
  const strip = $('camPreviews');
  const done = $('doneCamera');
  const empty = $('camPreviewsEmpty');
  const count = $('sessionCount');
  if(!strip) return;
  [...strip.querySelectorAll('.cam-preview')].forEach(el => el.remove());
  cameraSessionShots.forEach((shot, i) => {
    const item = document.createElement('div');
    item.className = 'cam-preview';
    item.title = shot.name;
    const img = document.createElement('img');
    img.src = shot.url;
    img.alt = `Shot ${i + 1}`;
    const n = document.createElement('span');
    n.className = 'cam-preview-n';
    n.textContent = String(i + 1);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'cam-preview-del';
    del.textContent = '×';
    del.setAttribute('aria-label', `Remove shot ${i + 1}`);
    del.onclick = async e => {
      e.stopPropagation();
      if(capturingBurst){ toast('Wait — still taking pictures'); return; }
      await removeSessionShot(i);
    };
    item.append(img, n, del);
    strip.append(item);
  });
  if(empty) empty.classList.toggle('hidden', cameraSessionShots.length > 0);
  if(count) count.textContent = String(cameraSessionShots.length);
  if(done){
    done.disabled = cameraSessionShots.length === 0 || capturingBurst;
    done.textContent = cameraSessionShots.length
      ? `Done (${cameraSessionShots.length})`
      : 'Done';
  }
  const last = strip.querySelector('.cam-preview:last-of-type');
  if(last) last.scrollIntoView({behavior:'smooth', inline:'end', block:'nearest'});
}

function clearCameraSessionPreviews(){
  cameraSessionShots.forEach(shot => { try{ URL.revokeObjectURL(shot.url); }catch(_){} });
  cameraSessionShots = [];
  renderCamPreviews();
  const progress = $('shotProgress');
  if(progress){ progress.textContent=''; progress.classList.add('hidden'); }
}

async function takeOneStill(){
  const v=$('video'); if(!v.videoWidth) throw new Error('Camera is not ready yet');
  const desired=cameraResolution?.value||'native';
  let [ow,oh]=cameraSize();
  const orientation=cameraOrientation?.value||'auto';
  if(orientation==='portrait' && ow>oh)[ow,oh]=[oh,ow];
  if(orientation==='landscape' && oh>ow)[ow,oh]=[oh,ow];

  let sourceBlob=null;
  if(desired==='native' && cameraImageCapture && cameraImageCapture.takePhoto){
    try { sourceBlob=await cameraImageCapture.takePhoto(); }
    catch(e) { sourceBlob=null; }
  }

  const source = sourceBlob ? await createImageBitmap(sourceBlob) : v;
  const srcW=source.width||source.videoWidth, srcH=source.height||source.videoHeight;
  const q=document.createElement('canvas');
  if(desired==='native') { ow=srcW; oh=srcH; }
  q.width=ow; q.height=oh;
  const x=q.getContext('2d',{alpha:false});
  x.imageSmoothingEnabled=true; x.imageSmoothingQuality='high';
  const sc=Math.max(ow/srcW,oh/srcH),dw=srcW*sc,dh=srcH*sc;
  x.drawImage(source,(ow-dw)/2,(oh-dh)/2,dw,dh);
  if(overlay) x.drawImage(overlay,0,0,ow,oh);
  if(sourceBlob && source.close) try{ source.close(); }catch(_){}

  const blob = await new Promise((resolve, reject) => {
    q.toBlob(b => b ? resolve(b) : reject(new Error('Capture failed')), 'image/jpeg', 0.98);
  });
  const f=new File([blob],`CAM_${Date.now()}_${ow}x${oh}.jpg`,{type:'image/jpeg',lastModified:Date.now()});
  await addFiles([f]);
  const previewUrl = URL.createObjectURL(blob);
  const stored = photos.find(p => p.name === f.name);
  cameraSessionShots.push({ url: previewUrl, name: f.name, width: ow, height: oh, photoId: stored?.id });
  renderCamPreviews();
  return { ow, oh };
}

async function captureCameraImproved(){
  if(capturingBurst) return;
  const v=$('video'); if(!v.videoWidth){toast('Camera is not ready yet');return}
  const total = Math.max(1, Math.min(20, parseInt($('shotCount')?.value || '1', 10) || 1));
  const captureBtn = $('capture');
  const progress = $('shotProgress');
  capturingBurst = true;
  captureBtn?.classList.add('shooting');
  if($('doneCamera')) $('doneCamera').disabled = true;
  if($('closeCam')) $('closeCam').disabled = true;
  try{
    for(let i = 0; i < total; i++){
      if(progress){
        progress.classList.remove('hidden');
        progress.textContent = total > 1 ? `Shot ${i + 1} of ${total}` : 'Capturing…';
      }
      const result = await takeOneStill();
      $('camQuality').textContent = `Saved ${result.ow} × ${result.oh} · keep shooting or tap Done`;
      if(i < total - 1) await new Promise(r => setTimeout(r, 280));
    }
    toast(total > 1
      ? `${total} shots added · camera still open`
      : `Shot saved · camera still open`);
    if(progress){
      progress.textContent = total > 1 ? `${total} shots in session` : 'Shot in session';
      clearTimeout(captureCameraImproved._hideProgress);
      captureCameraImproved._hideProgress = setTimeout(() => progress.classList.add('hidden'), 1400);
    }
  }catch(e){
    toast(e?.message || 'Capture failed');
  }finally{
    capturingBurst = false;
    captureBtn?.classList.remove('shooting');
    if($('closeCam')) $('closeCam').disabled = false;
    renderCamPreviews();
  }
}
$('capture').onclick=captureCameraImproved;

async function finishCameraSession(){
  if(capturingBurst){
    toast('Wait — still taking pictures');
    return;
  }
  const n = cameraSessionShots.length;
  cameraModal.classList.add('hidden');
  stopCamera();
  await exitCameraFullscreen();
  clearCameraSessionPreviews();
  if(n) toast(`${n} photo${n>1?'s':''} ready to edit`);
}
$('doneCamera')?.addEventListener('click', finishCameraSession);

/* Mobile quick navigation */
$('mImport')?.addEventListener('click',()=>{$('files')?.click()});
$('mGallery')?.addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();openGallery()});
$('mCamera')?.addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();$('cam')?.click()});
$('mTemplate')?.addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();$('modal')?.classList.remove('hidden');});
$('mInfo')?.addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();$('infoBtn')?.click()});

// Improve continuous autofocus after the camera becomes live.
async function ensureAutofocus(){
  if(!cameraTrack?.getCapabilities) return;
  const caps=cameraTrack.getCapabilities();
  if(!caps.focusMode) return;
  try{
    if(caps.focusMode.includes('continuous')) await cameraTrack.applyConstraints({advanced:[{focusMode:'continuous'}]});
  }catch(e){}
}
$('video').addEventListener('loadedmetadata',()=>setTimeout(ensureAutofocus,120));

/* Photo settings drawer: framing, exposure, and labels on demand. */
const settingsDrawer = $('settingsDrawer');
const settingsScrim = $('settingsScrim');

function settingsOpen(){
  return settingsDrawer && !settingsDrawer.classList.contains('hidden');
}
function updateSettingsTarget(){
  const target = $('settingsTarget');
  if(!target) return;
  target.textContent = selected >= 0 && photos[selected]
    ? `${selected + 1} of ${photos.length} · ${photos[selected].name}`
    : 'No photo selected · labels still apply';
}
function openSettings(){
  if(!settingsDrawer) return;
  updateSettingsTarget();
  settingsDrawer.classList.remove('hidden');
  settingsDrawer.setAttribute('aria-hidden','false');
  settingsScrim?.classList.remove('hidden');
  $('status').textContent = selected >= 0 ? 'Photo settings open' : 'Photo settings · select a photo to adjust framing';
}
function closeSettings(){
  if(!settingsDrawer) return;
  settingsDrawer.classList.add('hidden');
  settingsDrawer.setAttribute('aria-hidden','true');
  settingsScrim?.classList.add('hidden');
}
function toggleSettings(){
  settingsOpen() ? closeSettings() : openSettings();
}

$('settingsBtn')?.addEventListener('click', toggleSettings);
$('closeSettings')?.addEventListener('click', closeSettings);
$('applySettings')?.addEventListener('click', closeSettings);
settingsScrim?.addEventListener('click', closeSettings);
document.addEventListener('keydown', e => { if(e.key === 'Escape' && settingsOpen()) closeSettings(); });

$('infoBtn').onclick = openSettings;
$('infoNav').onclick = openSettings;
$('mInfo')?.addEventListener('click', openSettings);

const selectWithSettings = select;
select = function(i){
  selectWithSettings(i);
  updateSettingsTarget();
};
updateSettingsTarget();

/* Google Drive export: same composition pipeline as local JPG/ZIP export. */
function driveConfigured(){
  return Boolean(window.DocuDrive?.isConfigured());
}
function refreshDriveStatusLine(){
  const line = $('driveStatusLine');
  if(!line || !window.DocuDrive) return;
  line.textContent = window.DocuDrive.usingPreset()
    ? 'Using the built-in Client ID — no setup needed.'
    : 'Using your own Client ID saved on this device.';
  line.classList.toggle('custom', !window.DocuDrive.usingPreset());
}
function openDriveSetup(){
  const modal = $('driveModal');
  if(!modal) return;
  $('driveOrigin').textContent = window.location.origin;
  $('driveFolderName').textContent = window.DocuDrive?.folderName || 'DocuFrame';
  $('driveClientId').value = window.DocuDrive?.getStoredClientId() || '';
  $('driveClientId').placeholder = window.DocuDrive?.presetClientId || 'xxxxxxxx.apps.googleusercontent.com';
  refreshDriveStatusLine();
  modal.classList.remove('hidden');
}
function closeDriveSetup(){
  $('driveModal')?.classList.add('hidden');
}
$('closeDrive')?.addEventListener('click', closeDriveSetup);
$('driveSaveId')?.addEventListener('click', () => {
  const value = $('driveClientId').value.trim();
  if(!value){ toast('Paste your Google OAuth Client ID'); return; }
  if(!/\.apps\.googleusercontent\.com$/.test(value)){
    toast('That does not look like a Google Client ID');
    return;
  }
  window.DocuDrive.setClientId(value);
  closeDriveSetup();
  toast('Drive connected · tap Save to Drive again');
});
$('driveForget')?.addEventListener('click', () => {
  window.DocuDrive.setClientId('');
  window.DocuDrive.signOut();
  $('driveClientId').value = '';
  refreshDriveStatusLine();
  toast('Back to the built-in Client ID');
});

async function renderPhotoBlob(index){
  const original = selected;
  selected = index;
  try{
    const [ow, oh] = chosenResolution();
    const out = document.createElement('canvas');
    out.width = ow; out.height = oh;
    const octx = out.getContext('2d', {alpha:false});
    if(!(await drawComposition(octx, ow, oh))) return null;
    const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.96));
    return blob ? { blob, name: outputName() } : null;
  }finally{
    selected = original;
  }
}

async function saveToDrive(indices){
  if(!photos.length){ toast('No photos to upload'); return; }
  if(!driveConfigured()){ openDriveSetup(); return; }
  const targets = indices?.length ? indices : (selected >= 0 ? [selected] : []);
  if(!targets.length){ toast('Select a photo first'); return; }

  const buttons = [$('batchZip'), $('galleryZip')].filter(Boolean);
  buttons.forEach(b => { b.disabled = true; });
  $('status').textContent = 'Preparing upload…';
  try{
    const files = [];
    for(const i of targets){
      const rendered = await renderPhotoBlob(i);
      if(rendered) files.push(rendered);
    }
    if(!files.length) throw new Error('Could not render these photos');
    if(selected >= 0) await drawPreview();

    const { uploaded } = await window.DocuDrive.upload(files, (done, total) => {
      $('status').textContent = `Uploading to Drive ${Math.min(done + 1, total)} of ${total}…`;
    });
    const folder = window.DocuDrive.folderName;
    $('status').textContent = `Uploaded ${uploaded.length} photo${uploaded.length>1?'s':''} to Drive · ${folder}`;
    toast(`Saved ${uploaded.length} photo${uploaded.length>1?'s':''} to Drive · ${folder}`);
  }catch(e){
    const msg = e?.message || 'Drive upload failed';
    $('status').textContent = `Drive: ${msg}`;
    toast(msg);
    if(/Client ID/i.test(msg)) openDriveSetup();
  }finally{
    buttons.forEach(b => { b.disabled = false; });
  }
}

/* Batch export chooser: local ZIP or Google Drive. */
function batchTargets(){
  const checked = [...document.querySelectorAll('.gcheck:checked')].map(c => Number(c.dataset.index));
  return checked.length ? checked : [...photos.keys()];
}
function openExportChooser(){
  if(!photos.length){ toast('No photos to export'); return; }
  const targets = batchTargets();
  const lead = $('exportLead');
  if(lead){
    const all = targets.length === photos.length;
    lead.textContent = `${targets.length} photo${targets.length>1?'s':''}${all ? '' : ' selected'} · choose where to save.`;
  }
  $('exportModal')?.classList.remove('hidden');
}
function closeExportChooser(){
  $('exportModal')?.classList.add('hidden');
}

if($('batchZip')) $('batchZip').onclick = openExportChooser;
if($('galleryZip')) $('galleryZip').onclick = openExportChooser;
$('closeExport')?.addEventListener('click', closeExportChooser);
$('exportModal')?.addEventListener('click', e => { if(e.target === $('exportModal')) closeExportChooser(); });
document.addEventListener('keydown', e => { if(e.key === 'Escape') closeExportChooser(); });

$('exportLocal')?.addEventListener('click', async () => {
  closeExportChooser();
  await exportBatchZip();
});
$('exportDrive')?.addEventListener('click', async () => {
  const targets = batchTargets();
  closeExportChooser();
  await saveToDrive(targets);
});
$('driveSettingsLink')?.addEventListener('click', () => {
  closeExportChooser();
  openDriveSetup();
});
