const $=id=>document.getElementById(id); const W=940,H=788;
const canvas=$('canvas'),ctx=canvas.getContext('2d',{alpha:false});
let photos=[],selected=-1,overlay=null,overlayURL=null,stream=null,camFacing='environment',cameraTrack=null;

/* --- Persistent local photo storage (IndexedDB) --- */
const DB_NAME='docuframe_local_v1', DB_VER=1, PHOTO_STORE='photos';
let db=null;
function openPhotoDB(){
  if(db) return Promise.resolve(db);
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VER);
    req.onupgradeneeded=()=>{ const d=req.result; if(!d.objectStoreNames.contains(PHOTO_STORE)){ const st=d.createObjectStore(PHOTO_STORE,{keyPath:'id'}); st.createIndex('addedAt','addedAt'); } };
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
[['zoom','z'],['x','x'],['y','y'],['rot','r'],['bright','b'],['contrast','c']].forEach(([id,key])=>$(id).addEventListener('input',()=>{if(selected<0)return;photos[selected].e[key]=Number($(id).value);dbPutPhoto(photos[selected]);updateReadouts();drawPreview()}));['project','custom'].forEach(id=>$(id).addEventListener('input',drawPreview));
async function drawComposition(target,ow,oh){target.clearRect(0,0,ow,oh);target.fillStyle='#202832';target.fillRect(0,0,ow,oh);if(selected<0)return false;const p=photos[selected];let im;try{im=await loadImage(p.file)}catch{return false}const e=p.e,scale=Math.max(ow/im.naturalWidth,oh/im.naturalHeight);target.save();target.translate(ow/2+e.x*(ow/W),oh/2+e.y*(oh/H));target.rotate(e.r*Math.PI/180);target.scale(e.z,e.z);target.filter=`brightness(${e.b}) contrast(${e.c})`;const dw=im.naturalWidth*scale,dh=im.naturalHeight*scale;target.drawImage(im,-dw/2,-dh/2,dw,dh);target.restore();target.filter='none';if(overlay)target.drawImage(overlay,0,0,ow,oh);const project=$('project').value.trim(),custom=$('custom').value.trim();if(project||custom){const s=ow/W;target.fillStyle='#000b';target.fillRect(18*s,(H-58)*s,(W-36)*s,40*s);target.fillStyle='#fff';target.font=`bold ${13*s}px system-ui`;target.fillText(project,30*s,(H-35)*s);target.font=`${10*s}px system-ui`;target.fillText(custom,30*s,(H-19)*s)}return true}
async function drawPreview(){updateReadouts();const ok=await drawComposition(ctx,W,H);$('empty').style.display=(selected>=0&&ok)?'none':'block'}
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
$('batchZip').onclick=exportBatchZip; $('galleryZip').onclick=exportBatchZip;
$('resolution').onchange=()=>{const c=$('resolution').value==='custom';$('customW').classList.toggle('hidden',!c);$('customH').classList.toggle('hidden',!c);$('times').classList.toggle('hidden',!c)};$('reset').onclick=()=>{if(selected<0)return;photos[selected].e={z:1,x:0,y:0,r:0,b:1,c:1};dbPutPhoto(photos[selected]);select(selected)};
$('tpl').onclick=()=>$('modal').classList.remove('hidden');$('closeTpl').onclick=()=>$('modal').classList.add('hidden');$('templateFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{overlay=await loadImage(f);overlayURL=URL.createObjectURL(f);$('templatePreview').src=overlayURL;$('modal').classList.add('hidden');drawPreview();toast('Template loaded')}catch{toast('Template PNG could not be loaded')}};
function stopCamera(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}cameraTrack=null}
async function startCamera(){stopCamera();try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:camFacing},width:{ideal:3840},height:{ideal:2160}},audio:false});$('video').srcObject=stream;cameraTrack=stream.getVideoTracks()[0];const s=cameraTrack.getSettings();$('camQuality').textContent=`Live: ${s.width||'?'} × ${s.height||'?'} · output can use native`;liveDraw()}catch(e){toast('Camera needs permission and HTTPS/localhost')}}
$('cam').onclick=async()=>{$('cameraModal').classList.remove('hidden');await startCamera()};$('closeCam').onclick=()=>{$('cameraModal').classList.add('hidden');stopCamera()};$('switchCam').onclick=async()=>{camFacing=camFacing==='environment'?'user':'environment';await startCamera()};
$('cameraResolution').onchange=()=>{const c=$('cameraResolution').value==='custom';$('camCustom').classList.toggle('hidden',!c)};
function liveDraw(){if($('cameraModal').classList.contains('hidden'))return;const v=$('video'),l=$('live'),x=l.getContext('2d');x.clearRect(0,0,W,H);if(v.videoWidth&&v.videoHeight){const sc=Math.max(W/v.videoWidth,H/v.videoHeight),dw=v.videoWidth*sc,dh=v.videoHeight*sc;x.drawImage(v,(W-dw)/2,(H-dh)/2,dw,dh)}if(overlay)x.drawImage(overlay,0,0,W,H);requestAnimationFrame(liveDraw)}
function cameraSize(){const v=$('cameraResolution').value;if(v==='native'){return [cameraTrack?.getSettings().width||$('video').videoWidth,cameraTrack?.getSettings().height||$('video').videoHeight]}if(v==='custom')return [Math.max(100,parseInt($('camW').value)||1920),Math.max(100,parseInt($('camH').value)||1080)];return v.split('x').map(Number)}
$('capture').onclick=async()=>{const v=$('video');if(!v.videoWidth){toast('Camera is not ready yet');return}const [ow,oh]=cameraSize(),q=document.createElement('canvas');q.width=ow;q.height=oh;const x=q.getContext('2d',{alpha:false});const sc=Math.max(ow/v.videoWidth,oh/v.videoHeight),dw=v.videoWidth*sc,dh=v.videoHeight*sc;x.drawImage(v,(ow-dw)/2,(oh-dh)/2,dw,dh);if(overlay)x.drawImage(overlay,0,0,ow,oh);q.toBlob(async b=>{if(!b)return;const f=new File([b],`CAM_${Date.now()}_${ow}x${oh}.jpg`,{type:'image/jpeg'});await addFiles([f]);$('cameraModal').classList.add('hidden');stopCamera();toast(`Captured ${ow} × ${oh}`)},'image/jpeg',.96)};
function openGallery(){renderGallery();$('galleryModal').classList.remove('hidden')}function renderGallery(){ $('galleryCount').textContent=photos.length;const g=$('galleryGrid');g.innerHTML='';if(!photos.length){g.innerHTML='<div class="empty">No photos yet</div>';return}photos.forEach((p,i)=>{const card=document.createElement('div');card.className='gitem '+(i===selected?'current':'');const cb=document.createElement('input');cb.type='checkbox';cb.dataset.index=i;cb.className='gcheck';const im=document.createElement('img');im.src=p.url;im.loading='lazy';const cap=document.createElement('div');cap.textContent=`${i+1}. ${p.name}`;card.append(cb,im,cap);card.onclick=e=>{if(e.target===cb)return;cb.checked=!cb.checked;select(i);card.classList.toggle('checked',cb.checked)};cb.onclick=e=>e.stopPropagation();g.append(card)})}
$('galleryBtn').onclick=()=>openGallery();$('closeGallery').onclick=()=>$('galleryModal').classList.add('hidden');$('selectAll').onclick=()=>{document.querySelectorAll('.gcheck').forEach(c=>c.checked=true)};$('deleteSelected').onclick=async()=>{const ids=[...document.querySelectorAll('.gcheck:checked')].map(c=>Number(c.dataset.index)).sort((a,b)=>b-a);if(!ids.length)return toast('Select photos to delete');for(const i of ids){const rec=photos[i]; if(rec){await dbDeletePhoto(rec.id); URL.revokeObjectURL(rec.url); photos.splice(i,1); if(selected===i)selected=-1; else if(selected>i)selected--;}}if(selected<0&&photos.length)selected=0;renderList();if(selected>=0)select(selected);else drawPreview();renderGallery();toast(`${ids.length} photo${ids.length>1?'s':''} deleted`)};$('editSelected').onclick=()=>{const checks=[...document.querySelectorAll('.gcheck:checked')].map(c=>Number(c.dataset.index));if(checks.length!==1)return toast('Select exactly one photo to edit');select(checks[0]);$('galleryModal').classList.add('hidden');$('status').textContent=`Editing photo ${checks[0]+1}`};
function showInfo(){$('edit').classList.add('hidden');$('info').classList.remove('hidden');$('status').textContent='Info panel'}; $('infoBtn').onclick=showInfo; $('infoNav').onclick=showInfo;
renderList();updateReadouts(); dbLoadPhotos();

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
$('cam').onclick=async()=>{await enterCameraFullscreen(); cameraModal.classList.remove('hidden'); await startCameraImproved()};
$('closeCam').onclick=async()=>{cameraModal.classList.add('hidden');stopCamera();await exitCameraFullscreen()};
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

async function captureCameraImproved(){
  const v=$('video'); if(!v.videoWidth){toast('Camera is not ready yet');return}
  const desired=cameraResolution?.value||'native';
  let [ow,oh]=cameraSize();
  const orientation=cameraOrientation?.value||'auto';
  if(orientation==='portrait' && ow>oh)[ow,oh]=[oh,ow];
  if(orientation==='landscape' && oh>ow)[ow,oh]=[oh,ow];

  // For Native mode, prefer ImageCapture.takePhoto() so the saved file uses
  // the camera's still-photo pipeline instead of a lower-quality video frame.
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
  if(sourceBlob && source.close) source.close();
  q.toBlob(async b=>{
    if(!b){toast('Capture failed');return}
    const f=new File([b],`CAM_${Date.now()}_${ow}x${oh}.jpg`,{type:'image/jpeg',lastModified:Date.now()});
    await addFiles([f]);
    cameraModal.classList.add('hidden');stopCamera();await exitCameraFullscreen();
    toast(`Captured ${ow} × ${oh} · camera quality preserved`);
  },'image/jpeg',0.98);
}
$('capture').onclick=captureCameraImproved;

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
