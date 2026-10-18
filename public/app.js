const $=id=>document.getElementById(id); const W=940,H=788;
const canvas=$('canvas'),ctx=canvas.getContext('2d',{alpha:false});
let photos=[],selected=-1,overlay=null,overlayURL=null,stream=null,camFacing='environment',cameraTrack=null;

const THUMB_MAX=240, FILE_CACHE_MAX=24, PREVIEW_MAX_EDGE=2048, STORE_MAX_EDGE=2560, SIDEBAR_H=68, SIDEBAR_W=104;
const fileCache=new Map();
let previewGen=0;
const thumbCanvas=document.createElement('canvas');
const thumbCtx=thumbCanvas.getContext('2d',{alpha:false});
const storeCanvas=document.createElement('canvas');
const storeCtx=storeCanvas.getContext('2d',{alpha:false});
let previewBitmap=null, previewBitmapId=null, bulkBusy=false, photoWindowRange={start:-1,end:-1};
const workCanvas=document.createElement('canvas');

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
async function dbPutRecord(row){
  const d=await openPhotoDB();
  await new Promise((res,rej)=>{ const tx=d.transaction(PHOTO_STORE,'readwrite'); tx.objectStore(PHOTO_STORE).put(row); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); });
}
async function dbGetPhoto(id){
  const d=await openPhotoDB();
  return new Promise((res,rej)=>{ const tx=d.transaction(PHOTO_STORE,'readonly'); const r=tx.objectStore(PHOTO_STORE).get(id); r.onsuccess=()=>res(r.result||null); r.onerror=()=>rej(r.error); });
}
async function dbPutPhoto(p, blob, thumb){
  const storedBlob = blob || p.file || (fileCache.get(p.id) || null);
  if(!storedBlob){ await dbPatchPhotoMeta(p); return 'meta'; }
  try{
    await dbPutRecord({id:p.id,blob:storedBlob,thumb:thumb||p.thumbBlob||undefined,name:p.name,width:p.width,height:p.height,addedAt:p.addedAt,e:p.e});
    p.file=null;
    return 'full';
  }catch(e){
    console.warn('Photo persistence failed', e);
    try{
      if(thumb){
        await dbPutRecord({id:p.id,blob:thumb,thumb,name:p.name,width:p.width,height:p.height,addedAt:p.addedAt,e:p.e});
        p.file=storedBlob;
        return 'thumb';
      }
    }catch(e2){ console.warn('Thumb-only persist failed', e2); }
    p.file=storedBlob;
    return 'memory';
  }
}
async function dbPatchPhotoMeta(p){
  try{
    const row=await dbGetPhoto(p.id);
    if(!row) return;
    row.e=p.e; row.name=p.name; row.width=p.width; row.height=p.height; row.addedAt=p.addedAt;
    if(p.thumbBlob && !row.thumb) row.thumb=p.thumbBlob;
    await dbPutRecord(row);
  }catch(e){ console.warn('Photo meta save failed',e); }
}
async function dbDeletePhoto(id){
  try{ const d=await openPhotoDB(); await new Promise((res,rej)=>{ const tx=d.transaction(PHOTO_STORE,'readwrite'); tx.objectStore(PHOTO_STORE).delete(id); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); }); }catch(e){ console.warn('Photo delete persistence failed',e); }
}
function rememberFile(id, blob){
  if(!blob) return;
  if(fileCache.has(id)) fileCache.delete(id);
  fileCache.set(id, blob);
  const pinned=photos[selected]?.id;
  while(fileCache.size>FILE_CACHE_MAX){
    const first=fileCache.keys().next().value;
    if(first===pinned || first===id){
      const rest=[...fileCache.keys()].filter(k=>k!==pinned && k!==id);
      if(!rest.length) break;
      fileCache.delete(rest[0]);
    }else{
      fileCache.delete(first);
    }
  }
}
async function getPhotoFile(p){
  if(fileCache.has(p.id)){ rememberFile(p.id, fileCache.get(p.id)); return fileCache.get(p.id); }
  if(p.file){ rememberFile(p.id, p.file); return p.file; }
  const row=await dbGetPhoto(p.id);
  const blob=row?.blob||row?.thumb;
  if(!blob) throw new Error('Photo data missing');
  rememberFile(p.id, blob);
  return blob;
}
function dropPhotoMemory(p){
  try{ if(p.thumbUrl) URL.revokeObjectURL(p.thumbUrl); }catch(_){}
  try{ if(p.url) URL.revokeObjectURL(p.url); }catch(_){}
  fileCache.delete(p.id);
  if(previewBitmapId===p.id){
    if(previewBitmap?.close) try{ previewBitmap.close(); }catch(_){}
    previewBitmap=null; previewBitmapId=null;
  }
}
async function dbLoadPhotos(){
  try{
    const d=await openPhotoDB();
    const rows=await new Promise((res,rej)=>{ const tx=d.transaction(PHOTO_STORE,'readonly'); const r=tx.objectStore(PHOTO_STORE).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); });
    rows.sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));
    photos=[];
    for(const row of rows){
      const thumbUrl=row.thumb?URL.createObjectURL(row.thumb):'';
      photos.push({id:row.id,name:row.name,width:row.width,height:row.height,addedAt:row.addedAt,e:row.e||{z:1,x:0,y:0,r:0,b:1,c:1},thumbUrl});
    }
    renderList();
    if(photos.length){ selected=0; select(0); $('status').textContent=`${photos.length} saved photo${photos.length>1?'s':''} restored · newest first`; }
    else { $('status').textContent='Ready · photos are saved on this device'; }
    fillMissingThumbs();
  }catch(e){ console.warn('Photo restore failed',e); $('status').textContent='Ready · local photo storage unavailable'; }
}
async function fillMissingThumbs(){
  for(let i=0;i<photos.length;i++){
    const p=photos[i];
    if(p.thumbUrl) continue;
    try{
      const file=await getPhotoFile(p);
      const made=await makeThumbBlob(file);
      if(!made?.blob) continue;
      p.thumbUrl=URL.createObjectURL(made.blob);
      const row=await dbGetPhoto(p.id);
      if(row){ row.thumb=made.blob; await dbPutRecord(row); }
      if(i%6===0){ updatePhotoWindow(true); if(!$('galleryModal')?.classList.contains('hidden')) renderGallery(); }
    }catch(e){ console.warn('Thumb rebuild failed', p.name, e); }
    await yieldUI();
  }
  renderList();
  if(!$('galleryModal')?.classList.contains('hidden')) renderGallery();
}

function toast(msg, ms=2800){const t=$('toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.add('hidden'),ms)}
function yieldUI(ms=0){ return new Promise(r => setTimeout(r, ms)); }
function loadImage(fileOrUrl){return new Promise((resolve,reject)=>{const url=typeof fileOrUrl==='string'?fileOrUrl:URL.createObjectURL(fileOrUrl);const im=new Image();im.decoding='async';im.onload=()=>{if(typeof fileOrUrl!=='string') setTimeout(()=>URL.revokeObjectURL(url),0);resolve(im)};im.onerror=()=>{if(typeof fileOrUrl!=='string')URL.revokeObjectURL(url);reject(new Error('decode'))};im.src=url})}
async function createBitmap(source, extra={}){
  try{ return await createImageBitmap(source, { imageOrientation:'from-image', ...extra }); }
  catch(_){
    try{ return extra && Object.keys(extra).length ? await createImageBitmap(source, extra) : await createImageBitmap(source); }
    catch(__){ return null; }
  }
}
function sourceWH(im){
  return [im.naturalWidth||im.width||0, im.naturalHeight||im.height||0];
}
function fitSize(w, h, maxEdge){
  const edge=Math.max(w,h);
  if(!maxEdge || edge<=maxEdge) return [Math.max(1,w), Math.max(1,h)];
  const scale=maxEdge/edge;
  return [Math.max(1, Math.round(w*scale)), Math.max(1, Math.round(h*scale))];
}
async function decodeImage(file, { maxEdge=PREVIEW_MAX_EDGE }={}){
  const preferResize = !!(maxEdge && (file.size||0) > 200000);
  let bmp = await createBitmap(file, preferResize ? { resizeWidth:maxEdge, resizeQuality:'medium' } : {});
  if(bmp){
    let [w,h]=sourceWH(bmp);
    if(maxEdge && Math.max(w,h)>maxEdge){
      const [nw,nh]=fitSize(w,h,maxEdge);
      const resized = await createBitmap(file, { resizeWidth:nw, resizeHeight:nh, resizeQuality:'medium' });
      if(resized){
        if(bmp.close) try{ bmp.close(); }catch(_){}
        bmp=resized;
        [w,h]=sourceWH(bmp);
      }
    }
    if(maxEdge && Math.max(w,h)>maxEdge){
      const [nw,nh]=fitSize(w,h,maxEdge);
      storeCanvas.width=nw; storeCanvas.height=nh;
      storeCtx.drawImage(bmp,0,0,nw,nh);
      if(bmp.close) try{ bmp.close(); }catch(_){}
      bmp = await createBitmap(storeCanvas) || bmp;
    }
    if(bmp && sourceWH(bmp)[0]>1 && sourceWH(bmp)[1]>1) return bmp;
  }
  const im=await loadImage(file);
  const [iw,ih]=sourceWH(im);
  if(!iw || !ih) throw new Error('decode');
  if(maxEdge && Math.max(iw,ih)>maxEdge){
    const [nw,nh]=fitSize(iw,ih,maxEdge);
    storeCanvas.width=nw; storeCanvas.height=nh;
    storeCtx.drawImage(im,0,0,nw,nh);
    const resized=await createBitmap(storeCanvas);
    if(resized) return resized;
  }
  return im;
}
function setBulk(done, total, label){
  const wrap=$('bulkProgress'), bar=$('bulkBar'), text=$('bulkLabel');
  if(!wrap) return;
  if(!total){ wrap.classList.add('hidden'); if(bar) bar.style.width='0%'; return; }
  wrap.classList.remove('hidden');
  const pct=Math.max(0, Math.min(100, Math.round((done/total)*100)));
  if(bar) bar.style.width=pct+'%';
  if(text) text.textContent=`${label} · ${done} / ${total}`;
  $('status').textContent=`${label} ${done} of ${total}`;
}
function isMobileRail(){ return window.matchMedia('(max-width: 850px)').matches; }
function sidebarMetrics(){ return isMobileRail() ? { mobile:true, size:SIDEBAR_W } : { mobile:false, size:SIDEBAR_H }; }
function bindPhotoScroller(){
  const el=$('photos');
  if(!el || el.dataset.virtualBound) return;
  el.dataset.virtualBound='1';
  el.addEventListener('scroll', () => updatePhotoWindow(), { passive:true });
}
window.addEventListener('resize', () => { if(photos.length) updatePhotoWindow(true); });
async function blobFromCanvas(source, quality=0.84, type='image/jpeg'){
  return await new Promise(r => source.toBlob(r, type, type==='image/jpeg' ? quality : undefined));
}
function isRawFile(file){
  if(!file) return false;
  if(/\.(cr2|crw|cr3|dng|nef|arw|orf|raf|rw2|raw)$/i.test(file.name||'')) return true;
  return /cr2|canon|x-raw|image\/dng|image\/x-nikon|image\/x-sony/i.test(file.type||'');
}
function jpegSofMarker(u8, soi, end){
  let i=soi+2;
  while(i<end-1){
    if(u8[i]!==0xFF){ i++; continue; }
    while(i<end && u8[i]===0xFF) i++;
    if(i>=end) break;
    const marker=u8[i++];
    if(marker===0xDA || marker===0xD9) break;
    if(marker>=0xC0 && marker<=0xCF && marker!==0xC4 && marker!==0xC8 && marker!==0xCC) return marker;
    if(marker===0x01 || (marker>=0xD0 && marker<=0xD7) || marker===0xD8) continue;
    if(i+1>=end) break;
    const len=(u8[i]<<8)|u8[i+1];
    if(len<2) break;
    i+=len;
  }
  return 0;
}
function jpegEndIndex(u8, soi){
  let i=soi+2;
  const n=u8.length;
  while(i<n){
    if(u8[i]!==0xFF){ i++; continue; }
    while(i<n && u8[i]===0xFF) i++;
    if(i>=n) return -1;
    const marker=u8[i++];
    if(marker===0xD9) return i;
    if(marker===0xD8) return -1;
    if(marker===0xDA){
      if(i+1>=n) return -1;
      i+=(u8[i]<<8)|u8[i+1];
      while(i<n-1){
        if(u8[i]===0xFF && u8[i+1]!==0x00 && u8[i+1]!==0xFF && !(u8[i+1]>=0xD0 && u8[i+1]<=0xD7)){
          if(u8[i+1]===0xD9) return i+2;
          i++;
          continue;
        }
        i++;
      }
      return -1;
    }
    if(marker===0x01 || (marker>=0xD0 && marker<=0xD7)) continue;
    if(i+1>=n) return -1;
    const len=(u8[i]<<8)|u8[i+1];
    if(len<2) return -1;
    i+=len;
  }
  return -1;
}
function extractBaselineJpegBytes(u8){
  let best=null, fallback=null;
  const n=u8.length;
  for(let i=0;i<n-3;i++){
    if(u8[i]!==0xFF || u8[i+1]!==0xD8 || u8[i+2]!==0xFF) continue;
    const end=jpegEndIndex(u8, i);
    if(end<0 || end-i<512) continue;
    const sof=jpegSofMarker(u8, i, end);
    const rec={ start:i, end, size:end-i };
    if(sof===0xC0 || sof===0xC1 || sof===0xC2){
      if(!best || rec.size>best.size) best=rec;
    }else if(!fallback || rec.size>fallback.size){
      fallback=rec;
    }
    i=end-1;
  }
  const pick=best||fallback;
  return pick ? u8.subarray(pick.start, pick.end) : null;
}
async function extractRawPreview(file){
  const buf=await file.arrayBuffer();
  const jpeg=extractBaselineJpegBytes(new Uint8Array(buf));
  if(!jpeg || jpeg.length<512) return null;
  return new Blob([jpeg], { type:'image/jpeg' });
}
async function fileForDecode(file){
  if(!isRawFile(file)) return file;
  const preview=await extractRawPreview(file);
  if(!preview) throw new Error('raw preview');
  return preview;
}
function pngNameFrom(file){
  const base=(file.name||'photo').replace(/\.[^.]+$/, '');
  return `${base || 'photo'}.png`;
}
async function preparePhoto(file){
  const raw=isRawFile(file);
  const source=await fileForDecode(file);
  const bmp=await decodeImage(source, { maxEdge: STORE_MAX_EDGE });
  const [width,height]=sourceWH(bmp);
  if(!width || !height) throw new Error('decode');
  const [sw,sh]=fitSize(width,height,STORE_MAX_EDGE);
  storeCanvas.width=sw; storeCanvas.height=sh;
  storeCtx.drawImage(bmp,0,0,sw,sh);
  const studio=await blobFromCanvas(storeCanvas, 0.86, raw ? 'image/png' : 'image/jpeg');
  const [tw,th]=fitSize(sw,sh,THUMB_MAX);
  thumbCanvas.width=tw; thumbCanvas.height=th;
  thumbCtx.drawImage(storeCanvas,0,0,tw,th);
  const thumb=await blobFromCanvas(thumbCanvas, 0.7);
  if(bmp.close) try{ bmp.close(); }catch(_){}
  if(!studio || !thumb) throw new Error('encode');
  return { studio, thumb, width:sw, height:sh, name: raw ? pngNameFrom(file) : file.name, converted: raw };
}
async function makeThumbBlob(source){
  const prepared=await preparePhoto(source);
  return { blob:prepared.thumb, width:prepared.width, height:prepared.height };
}
function makePhotoRow(i){
  const p=photos[i];
  const d=document.createElement('div');
  d.className='photo'+(i===selected?' active':'');
  d.dataset.index=String(i);
  const im=document.createElement('img');
  im.alt='';
  im.decoding='async';
  im.loading='lazy';
  if(p.thumbUrl) im.src=p.thumbUrl;
  const box=document.createElement('div'), b=document.createElement('b'), sm=document.createElement('small');
  b.textContent=p.name;
  sm.textContent=`${i+1} · ${p.width}×${p.height}`;
  box.append(b,sm);
  d.append(im,box);
  d.onclick=()=>select(i);
  return d;
}
function updatePhotoWindow(force){
  const el=$('photos');
  if(!el || !photos.length) return;
  bindPhotoScroller();
  let spacer=el.querySelector('.photos-spacer');
  let windowEl=el.querySelector('.photos-window');
  if(!spacer || !windowEl){
    el.innerHTML='';
    spacer=document.createElement('div'); spacer.className='photos-spacer';
    windowEl=document.createElement('div'); windowEl.className='photos-window';
    el.append(spacer, windowEl);
  }
  const { mobile, size } = sidebarMetrics();
  const total=photos.length;
  if(mobile){ spacer.style.width=`${total*size}px`; spacer.style.height='1px'; }
  else { spacer.style.height=`${total*size}px`; spacer.style.width='auto'; }
  const scroll = mobile ? el.scrollLeft : el.scrollTop;
  const view = Math.max(mobile ? el.clientWidth : el.clientHeight, size);
  const start = Math.max(0, Math.floor(scroll / size) - 10);
  const end = Math.min(total, Math.ceil((scroll + view) / size) + 10);
  if(!force && start===photoWindowRange.start && end===photoWindowRange.end) return;
  photoWindowRange={start,end};
  const frag=document.createDocumentFragment();
  for(let i=start;i<end;i++) frag.appendChild(makePhotoRow(i));
  windowEl.replaceChildren(frag);
  windowEl.style.transform = mobile ? `translateX(${start*size}px)` : `translateY(${start*size}px)`;
}
function renderList(){
  $('count').textContent=photos.length;
  const el=$('photos');
  if(!photos.length){
    photoWindowRange={start:-1,end:-1};
    el.innerHTML='<div class="empty">No photos yet</div>';
    return;
  }
  updatePhotoWindow(true);
}
function markActiveOnly(){
  document.querySelectorAll('#photos .photo').forEach(el => {
    el.classList.toggle('active', Number(el.dataset.index)===selected);
  });
  document.querySelectorAll('#galleryGrid .gitem').forEach(el => {
    el.classList.toggle('current', Number(el.dataset.index)===selected);
  });
}
function ensureRowVisible(i){
  const el=$('photos');
  if(!el || i<0) return;
  const { mobile, size } = sidebarMetrics();
  const start = mobile ? el.scrollLeft : el.scrollTop;
  const view = mobile ? el.clientWidth : el.clientHeight;
  const pos = i * size;
  if(pos < start){
    if(mobile) el.scrollLeft=pos; else el.scrollTop=pos;
  }else if(pos + size > start + view){
    if(mobile) el.scrollLeft=pos - view + size; else el.scrollTop=pos - view + size;
  }
  updatePhotoWindow();
}
function isImageFile(file){
  if(!file) return false;
  if(file.type && file.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|gif|bmp|heic|heif|dng|raw|cr2|crw|cr3|nef|arw|orf|raf|rw2)$/i.test(file.name||'');
}
function readAllDirEntries(dirEntry){
  const reader=dirEntry.createReader();
  return new Promise((resolve,reject)=>{
    const all=[];
    const tick=()=>reader.readEntries(batch=>{
      if(!batch.length) return resolve(all);
      all.push(...batch);
      tick();
    }, reject);
    tick();
  });
}
async function walkFileEntry(entry, out, depth=0){
  if(!entry || depth>5) return;
  if(entry.isFile){
    const file=await new Promise((res,rej)=>entry.file(res,rej));
    if(isImageFile(file)) out.push(file);
    return;
  }
  if(entry.isDirectory){
    const kids=await readAllDirEntries(entry);
    for(const child of kids) await walkFileEntry(child, out, depth+1);
  }
}
async function filesFromDataTransfer(dt){
  const items=[...(dt.items||[])];
  const entries=items.map(i=>i.webkitGetAsEntry?.()).filter(Boolean);
  if(entries.length){
    const out=[];
    for(const entry of entries) await walkFileEntry(entry, out);
    if(out.length) return out;
  }
  return [...(dt.files||[])];
}
async function walkFsHandle(handle, out, depth=0){
  if(!handle || depth>5) return;
  if(handle.kind==='file'){
    const file=await handle.getFile();
    if(isImageFile(file)) out.push(file);
    return;
  }
  if(handle.kind==='directory'){
    for await (const child of handle.values()) await walkFsHandle(child, out, depth+1);
  }
}
async function pickFolderFiles(){
  if(window.showDirectoryPicker){
    try{
      const dir=await window.showDirectoryPicker();
      const out=[];
      await walkFsHandle(dir, out);
      return out;
    }catch(e){
      if(e?.name==='AbortError') return [];
    }
  }
  $('folder')?.click();
  return [];
}
async function addFiles(list, opts={}){
  const { selectFirst=true } = opts;
  const files=[...list].filter(isImageFile);
  if(!files.length){
    $('status').textContent='No images reached the app';
    toast('Chrome often fails on huge gallery picks. Use Import folder, or select about 50 at a time.', 5200);
    return [];
  }
  if(bulkBusy){ toast('Still importing photos…'); return []; }
  bulkBusy=true;
  const added=[];
  const failed=[];
  let converted=0;
  const now=Date.now();
  const showBulk=files.length>2;
  try{
    if(showBulk) setBulk(0, files.length, 'Importing');
    for(let n=0;n<files.length;n++){
      const file=files[n];
      try{
        const { studio, thumb, width, height, name, converted:wasRaw } = await preparePhoto(file);
        if(wasRaw) converted++;
        const rec={
          id:crypto.randomUUID?crypto.randomUUID():`${Date.now()}_${Math.random().toString(36).slice(2)}`,
          name: name || file.name,
          width, height,
          addedAt:now+n,
          e:{z:1,x:0,y:0,r:0,b:1,c:1},
          thumbUrl: thumb ? URL.createObjectURL(thumb) : ''
        };
        photos.unshift(rec);
        rememberFile(rec.id, studio);
        const saved=await dbPutPhoto(rec, studio, thumb);
        if(saved==='memory') rec.file=studio;
        added.push(rec);
        if(added.length===1 && selectFirst){
          selected=0;
          markActiveOnly();
          $('empty').style.display='none';
        }
      }catch(e){
        console.warn('Cannot decode', file.name, e);
        failed.push(file.name);
      }
      if(showBulk) setBulk(n+1, files.length, 'Importing');
      if((n+1)%8===0 || n===files.length-1) renderList();
      await yieldUI((n+1)%12===0 ? 16 : 0);
    }
    photos.sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));
    renderList();
    if(added.length && selectFirst){ selected=0; await select(0); }
    else markActiveOnly();
    if(!$('galleryModal')?.classList.contains('hidden')) renderGallery();
    const extra=[
      converted?`${converted} CR2→PNG`:'',
      failed.length?`${failed.length} skipped`:''
    ].filter(Boolean).map(s=>' · '+s).join('');
    $('status').textContent=added.length?`${added.length} photo${added.length>1?'s':''} loaded · newest first${extra}`:'No supported images found';
    if(added.length) toast(converted?`${converted} CR2 converted to PNG`: `${added.length} photo${added.length>1?'s':''} imported${extra}`, 3600);
    else toast(failed.length?'Those files could not be decoded. CR2 needs an embedded preview JPEG. Try JPG/PNG if it still fails.':'No supported images found', 5200);
  }finally{
    bulkBusy=false;
    setBulk(0,0);
  }
  return added;
}

$('pick').onclick=()=>{$('files').click()};
$('files').addEventListener('change',async e=>{
  const list=[...e.target.files];
  e.target.value='';
  if(!list.length) return;
  await addFiles(list);
});
$('folder')?.addEventListener('change', async e=>{
  const list=[...e.target.files];
  e.target.value='';
  if(list.length) await addFiles(list);
});
$('pickFolder')?.addEventListener('click', async e=>{
  e.preventDefault();
  e.stopPropagation();
  const list=await pickFolderFiles();
  if(list.length) await addFiles(list);
});
$('drop').onclick=e=>{
  if(e.target.closest('#pickFolder')) return;
  $('files').click();
};
$('drop').ondragover=e=>{e.preventDefault();$('drop').style.background='#eaf2ff'};
$('drop').ondragleave=()=>{$('drop').style.background=''};
$('drop').ondrop=async e=>{
  e.preventDefault();
  $('drop').style.background='';
  const list=await filesFromDataTransfer(e.dataTransfer);
  await addFiles(list);
};
async function select(i){
  if(i<0||i>=photos.length)return;
  if(previewBitmapId && previewBitmapId!==photos[i].id){
    if(previewBitmap?.close) try{ previewBitmap.close(); }catch(_){}
    previewBitmap=null; previewBitmapId=null;
  }
  selected=i;
  const e=photos[i].e;
  $('zoom').value=e.z;$('x').value=e.x;$('y').value=e.y;$('rot').value=e.r;$('bright').value=e.b;$('contrast').value=e.c;
  markActiveOnly();
  ensureRowVisible(i);
  if(typeof updateSettingsTarget==='function') updateSettingsTarget();
  await drawPreview();
}
function updateReadouts(){if(selected<0)return;const e=photos[selected].e;$('zv').textContent=Math.round(e.z*100)+'%';$('xv').textContent=e.x;$('yv').textContent=e.y;$('rv').textContent=e.r+'°'}
let metaSaveTimer=null;
function scheduleMetaSave(p){
  clearTimeout(metaSaveTimer);
  metaSaveTimer=setTimeout(()=>dbPatchPhotoMeta(p), 280);
}
[['zoom','z'],['x','x'],['y','y'],['rot','r'],['bright','b'],['contrast','c']].forEach(([id,key])=>$(id).addEventListener('input',()=>{if(selected<0)return;photos[selected].e[key]=Number($(id).value);scheduleMetaSave(photos[selected]);updateReadouts();drawPreview()}));['project','custom'].forEach(id=>$(id).addEventListener('input',()=>{dbPutSetting(id,$(id).value);drawPreview();}));
async function getPreviewSource(p){
  if(previewBitmap && previewBitmapId===p.id && (previewBitmap.width||previewBitmap.naturalWidth)>1) return previewBitmap;
  if(previewBitmap?.close) try{ previewBitmap.close(); }catch(_){}
  previewBitmap=null; previewBitmapId=null;
  const file=await getPhotoFile(p);
  previewBitmap=await decodeImage(file, { maxEdge: PREVIEW_MAX_EDGE });
  previewBitmapId=p.id;
  return previewBitmap;
}
function sourceSize(im){
  return [im.naturalWidth||im.width||0, im.naturalHeight||im.height||0];
}
async function drawComposition(target,ow,oh,photo){
  target.clearRect(0,0,ow,oh);target.fillStyle='#202832';target.fillRect(0,0,ow,oh);
  const p=photo||photos[selected];
  if(!p) return false;
  let im, owned=false;
  try{
    if(photo && photo.id!==previewBitmapId){
      const file=await getPhotoFile(p);
      im=await decodeImage(file, { maxEdge: Math.max(ow, oh, PREVIEW_MAX_EDGE) });
      owned=!!im?.close;
    }else{
      im=await getPreviewSource(p);
    }
  }catch(e){ console.warn('Preview decode failed', p.name, e); return false; }
  const [iw,ih]=sourceSize(im);
  if(!iw || !ih) return false;
  const e=p.e,scale=Math.max(ow/iw,oh/ih);
  target.save();target.translate(ow/2+e.x*(ow/W),oh/2+e.y*(oh/H));target.rotate(e.r*Math.PI/180);target.scale(e.z,e.z);target.filter=`brightness(${e.b}) contrast(${e.c})`;
  const dw=iw*scale,dh=ih*scale;target.drawImage(im,-dw/2,-dh/2,dw,dh);target.restore();target.filter='none';
  if(overlay)target.drawImage(overlay,0,0,ow,oh);
  const project=$('project').value.trim(),custom=$('custom').value.trim();
  if(project||custom){const s=ow/W;target.fillStyle='#000b';target.fillRect(18*s,(H-58)*s,(W-36)*s,40*s);target.fillStyle='#fff';target.font=`bold ${13*s}px system-ui`;target.fillText(project,30*s,(H-35)*s);target.font=`${10*s}px system-ui`;target.fillText(custom,30*s,(H-19)*s)}
  if(owned && im.close) try{ im.close(); }catch(_){}
  return true;
}
async function drawPreview(){
  const gen=++previewGen;
  updateReadouts();
  const ok=await drawComposition(ctx,W,H);
  if(gen!==previewGen) return ok;
  $('empty').style.display=selected>=0?'none':'flex';
  if(selected>=0 && !ok){
    $('status').textContent='Could not display this photo · tap it in the list to retry';
    toast('Photo saved · tap it in the Photos list to show it');
  }
  return ok;
}
function chosenResolution(photo){
  const p=photo||photos[selected];
  const v=$('resolution').value;
  if(v==='original'&&p) return [p.width,p.height];
  if(v==='custom') return [Math.max(100,Math.min(12000,parseInt($('customW').value)||1920)),Math.max(100,Math.min(12000,parseInt($('customH').value)||1609))];
  return v.split('x').map(Number);
}
function outputName(index=selected){const prefix=($('project').value||'DOC').trim().replace(/[^\w-]+/g,'_')||'DOC';return `${prefix}_${String(index+1).padStart(3,'0')}.jpg`}
function canvasToBlob(source, quality=0.92){
  return new Promise(r => source.toBlob(r, 'image/jpeg', quality));
}
async function exportCurrent(){
  if(selected<0){toast('Upload/select a photo first.');return}
  const [ow,oh]=chosenResolution();
  workCanvas.width=ow; workCanvas.height=oh;
  const octx=workCanvas.getContext('2d',{alpha:false});
  if(!(await drawComposition(octx,ow,oh,photos[selected]))){toast('Could not render this photo.');return}
  const blob=await canvasToBlob(workCanvas, 0.94);
  if(!blob) return toast('Export failed.');
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=outputName();a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('status').textContent=`Saved ${ow} × ${oh}`;toast(`Saved ${ow} × ${oh} JPG`);
}
$('save').onclick=exportCurrent;
async function exportBatchZip(){
  if(bulkBusy){ toast('Wait — still working'); return; }
  if(!photos.length){toast('No photos to download.');return}
  if(typeof JSZip==='undefined'){toast('ZIP engine unavailable.');return}
  const indices=batchTargets();
  bulkBusy=true;
  const zip=new JSZip();
  toast(`Preparing ${indices.length} photo${indices.length>1?'s':''}…`);
  try{
    for(let n=0;n<indices.length;n++){
      const i=indices[n], p=photos[i];
      const [ow,oh]=chosenResolution(p);
      workCanvas.width=ow; workCanvas.height=oh;
      const octx=workCanvas.getContext('2d',{alpha:false});
      if(await drawComposition(octx,ow,oh,p)){
        const blob=await canvasToBlob(workCanvas, 0.92);
        if(blob) zip.file(outputName(i), blob);
      }
      setBulk(n+1, indices.length, 'Rendering');
      await yieldUI();
    }
    setBulk(indices.length, indices.length, 'Zipping');
    const blob=await zip.generateAsync({type:'blob',compression:'STORE',streamFiles:true},m=>{ $('status').textContent=`Zipping ${Math.round(m.percent)}%`; });
    const url=URL.createObjectURL(blob),a=document.createElement('a'); a.href=url; a.download=`${(($('project').value||'DocuFrame').trim().replace(/[^\w-]+/g,'_')||'DocuFrame')}_photos.zip`; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),2000); toast(`Batch ZIP ready · ${indices.length} photo${indices.length>1?'s':''}`); $('status').textContent=`ZIP exported · ${indices.length} photos`;
  }finally{
    bulkBusy=false;
    setBulk(0,0);
    if(selected>=0) drawPreview();
  }
}
if($('galleryZip')) $('galleryZip').onclick=exportBatchZip;
$('resolution').onchange=()=>{const c=$('resolution').value==='custom';$('customW').classList.toggle('hidden',!c);$('customH').classList.toggle('hidden',!c);$('times').classList.toggle('hidden',!c)};$('reset').onclick=()=>{if(selected<0)return;photos[selected].e={z:1,x:0,y:0,r:0,b:1,c:1};scheduleMetaSave(photos[selected]);select(selected)};
$('tpl').onclick=()=>$('modal').classList.remove('hidden');$('closeTpl').onclick=()=>$('modal').classList.add('hidden');$('templateFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(overlayURL)URL.revokeObjectURL(overlayURL);overlay=await loadImage(f);overlayURL=URL.createObjectURL(f);$('templatePreview').src=overlayURL;await dbPutSetting('overlay',{blob:f,name:f.name});$('modal').classList.add('hidden');drawPreview();renderGallery();toast('Template loaded · saved for all gallery photos')}catch{toast('Template PNG could not be loaded')}};
function stopCamera(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}cameraTrack=null}
function liveDraw(){if($('cameraModal').classList.contains('hidden'))return;const v=$('video'),l=$('live'),x=l.getContext('2d');x.clearRect(0,0,W,H);if(v.videoWidth&&v.videoHeight){const sc=Math.max(W/v.videoWidth,H/v.videoHeight),dw=v.videoWidth*sc,dh=v.videoHeight*sc;x.drawImage(v,(W-dw)/2,(H-dh)/2,dw,dh)}if(overlay)x.drawImage(overlay,0,0,W,H);requestAnimationFrame(liveDraw)}
function cameraSize(){const v=$('cameraResolution').value;if(v==='native'){return [cameraTrack?.getSettings().width||$('video').videoWidth,cameraTrack?.getSettings().height||$('video').videoHeight]}if(v==='custom')return [Math.max(100,parseInt($('camW').value)||1920),Math.max(100,parseInt($('camH').value)||1080)];return v.split('x').map(Number)}
function openGallery(){renderGallery();$('galleryModal').classList.remove('hidden')}
function renderGallery(){
  $('galleryCount').textContent=photos.length;
  const g=$('galleryGrid'); g.innerHTML='';
  if(!photos.length){g.innerHTML='<div class="empty">No photos yet</div>';return}
  const frag=document.createDocumentFragment();
  photos.forEach((p,i)=>{
    const card=document.createElement('div'); card.className='gitem'+(i===selected?' current':''); card.dataset.index=String(i);
    const cb=document.createElement('input'); cb.type='checkbox'; cb.dataset.index=i; cb.className='gcheck';
    const media=document.createElement('div'); media.className='gmedia';
    const im=document.createElement('img'); im.alt=''; im.decoding='async'; if(p.thumbUrl) im.src=p.thumbUrl;
    media.append(im);
    if(overlay){ const ov=document.createElement('img'); ov.className='gtemplate'; ov.src=overlayURL; ov.alt=''; ov.draggable=false; media.append(ov); }
    const cap=document.createElement('div'); cap.textContent=`${i+1}. ${p.name}`;
    card.append(cb,media,cap);
    card.onclick=e=>{if(e.target===cb)return; cb.checked=!cb.checked; select(i); card.classList.toggle('checked',cb.checked)};
    cb.onclick=e=>e.stopPropagation(); frag.append(card);
  });
  g.append(frag);
}

$('galleryBtn').onclick=()=>openGallery();$('closeGallery').onclick=()=>$('galleryModal').classList.add('hidden');$('selectAll').onclick=()=>{document.querySelectorAll('.gcheck').forEach(c=>c.checked=true)};$('deleteSelected').onclick=async()=>{const ids=[...document.querySelectorAll('.gcheck:checked')].map(c=>Number(c.dataset.index)).sort((a,b)=>b-a);if(!ids.length)return toast('Select photos to delete');for(const i of ids){const rec=photos[i]; if(rec){await dbDeletePhoto(rec.id); dropPhotoMemory(rec); photos.splice(i,1); if(selected===i)selected=-1; else if(selected>i)selected--;}}if(selected<0&&photos.length)selected=0;renderList();if(selected>=0)select(selected);else drawPreview();renderGallery();toast(`${ids.length} photo${ids.length>1?'s':''} deleted`)};$('editSelected').onclick=()=>{const checks=[...document.querySelectorAll('.gcheck:checked')].map(c=>Number(c.dataset.index));if(checks.length!==1)return toast('Select exactly one photo to edit');select(checks[0]);$('galleryModal').classList.add('hidden');$('status').textContent=`Editing photo ${checks[0]+1}`};
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
    dropPhotoMemory(rec);
    photos.splice(photoIndex, 1);
    if(selected === photoIndex) selected = photos.length ? 0 : -1;
    else if(selected > photoIndex) selected--;
    renderList();
    if(selected >= 0) select(selected); else drawPreview();
    renderGallery();
  }
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
  const added = await addFiles([f], { selectFirst:false });
  const stored = added[0] || photos.find(p => p.name === f.name);
  cameraSessionShots.push({ url: stored?.thumbUrl || '', name: f.name, width: ow, height: oh, photoId: stored?.id });
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
  const p = photos[index];
  if(!p) return null;
  const [ow, oh] = chosenResolution(p);
  workCanvas.width = ow; workCanvas.height = oh;
  const octx = workCanvas.getContext('2d', {alpha:false});
  if(!(await drawComposition(octx, ow, oh, p))) return null;
  const blob = await canvasToBlob(workCanvas, 0.92);
  return blob ? { blob, name: outputName(index) } : null;
}

async function saveToDrive(indices){
  if(bulkBusy){ toast('Wait — still working'); return; }
  if(!photos.length){ toast('No photos to upload'); return; }
  if(!driveConfigured()){ openDriveSetup(); return; }
  const targets = indices?.length ? indices : (selected >= 0 ? [selected] : []);
  if(!targets.length){ toast('Select a photo first'); return; }

  const buttons = [$('batchZip'), $('galleryZip')].filter(Boolean);
  buttons.forEach(b => { b.disabled = true; });
  bulkBusy = true;
  $('status').textContent = 'Preparing upload…';
  let uploadedCount = 0;
  try{
    const chunkSize = 3;
    for(let i=0;i<targets.length;i+=chunkSize){
      const files = [];
      const slice = targets.slice(i, i+chunkSize);
      for(const index of slice){
        const rendered = await renderPhotoBlob(index);
        if(rendered) files.push(rendered);
        await yieldUI();
      }
      if(!files.length) continue;
      const { uploaded } = await window.DocuDrive.upload(files, (done, total) => {
        setBulk(uploadedCount + done, targets.length, 'Uploading');
      });
      uploadedCount += uploaded.length;
      setBulk(uploadedCount, targets.length, 'Uploading');
    }
    if(!uploadedCount) throw new Error('Could not render these photos');
    if(selected >= 0) await drawPreview();
    const folder = window.DocuDrive.folderName;
    $('status').textContent = `Uploaded ${uploadedCount} photo${uploadedCount>1?'s':''} to Drive · ${folder}`;
    toast(`Saved ${uploadedCount} photo${uploadedCount>1?'s':''} to Drive · ${folder}`);
  }catch(e){
    const msg = e?.message || 'Drive upload failed';
    $('status').textContent = `Drive: ${msg}`;
    toast(msg);
    if(/Client ID/i.test(msg)) openDriveSetup();
  }finally{
    bulkBusy = false;
    setBulk(0,0);
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
