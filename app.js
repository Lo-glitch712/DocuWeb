const $=id=>document.getElementById(id);
const W=940,H=788;
const canvas=$('canvas'),ctx=canvas.getContext('2d',{alpha:false});
let photos=[],selected=-1,overlay=null,overlayURL=null,stream=null;

function toast(msg){const t=$('toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.add('hidden'),2200)}
function loadImage(fileOrUrl){
  return new Promise((resolve,reject)=>{
    const url=typeof fileOrUrl==='string'?fileOrUrl:URL.createObjectURL(fileOrUrl);
    const im=new Image();
    im.onload=()=>{if(typeof fileOrUrl!=='string')URL.revokeObjectURL(url);resolve(im)};
    im.onerror=()=>{if(typeof fileOrUrl!=='string')URL.revokeObjectURL(url);reject(new Error('decode'))};
    im.src=url;
  });
}
function renderList(){
  $('count').textContent=photos.length;
  if(!photos.length){$('photos').innerHTML='<div class="empty">No photos yet</div>';return}
  $('photos').innerHTML='';
  photos.forEach((p,i)=>{
    const d=document.createElement('div');d.className='photo '+(i===selected?'active':'');
    const im=document.createElement('img');im.src=p.url;
    const box=document.createElement('div'),b=document.createElement('b'),sm=document.createElement('small');
    b.textContent=p.name;sm.textContent=`Photo ${i+1}`;
    box.append(b,sm);d.append(im,box);d.onclick=()=>select(i);$('photos').append(d);
  });
}
async function addFiles(list){
  let added=0;
  for(const file of list){
    if(!file.type.startsWith('image/')&&!/\.(png|jpe?g|webp)$/i.test(file.name))continue;
    try{
      const im=await loadImage(file);
      const p={file,name:file.name,url:URL.createObjectURL(file),width:im.naturalWidth,height:im.naturalHeight,
        e:{z:1,x:0,y:0,r:0,b:1,c:1}};
      photos.push(p);added++;
    }catch(e){console.warn('Cannot decode',file.name,e)}
  }
  renderList();
  if(selected<0&&photos.length)select(0);
  $('status').textContent=added?`${added} photo${added>1?'s':''} loaded`:'No supported images found';
}
$('pick').onclick=()=>$('files').click();
$('files').addEventListener('change',async e=>{await addFiles([...e.target.files]);e.target.value=''});
$('drop').onclick=()=>$('files').click();
$('drop').ondragover=e=>{e.preventDefault();$('drop').style.background='#eaf2ff'};
$('drop').ondragleave=()=>{$('drop').style.background=''};
$('drop').ondrop=e=>{e.preventDefault();$('drop').style.background='';addFiles([...e.dataTransfer.files])};

function select(i){
  selected=i;
  const e=photos[i].e;
  $('zoom').value=e.z;$('x').value=e.x;$('y').value=e.y;$('rot').value=e.r;$('bright').value=e.b;$('contrast').value=e.c;
  renderList();drawPreview();
}
function updateReadouts(){
  if(selected<0)return;
  const e=photos[selected].e;
  $('zv').textContent=Math.round(e.z*100)+'%';$('xv').textContent=e.x;$('yv').textContent=e.y;$('rv').textContent=e.r+'°';
}
[['zoom','z'],['x','x'],['y','y'],['rot','r'],['bright','b'],['contrast','c']].forEach(([id,key])=>{
  $(id).addEventListener('input',()=>{if(selected<0)return;photos[selected].e[key]=Number($(id).value);updateReadouts();drawPreview()});
});
['project','custom'].forEach(id=>$(id).addEventListener('input',drawPreview));

async function drawComposition(target,ow,oh){
  target.clearRect(0,0,ow,oh);
  target.fillStyle='#202832';target.fillRect(0,0,ow,oh);
  if(selected<0)return false;
  const p=photos[selected];
  let im;
  try{im=await loadImage(p.file)}catch(e){return false}
  const e=p.e;
  // Fit source image to composition without stretching, then apply user transforms.
  const scale=Math.max(ow/im.naturalWidth,oh/im.naturalHeight);
  target.save();
  target.translate(ow/2 + e.x*(ow/W), oh/2 + e.y*(oh/H));
  target.rotate(e.r*Math.PI/180);
  target.scale(e.z,e.z);
  target.filter=`brightness(${e.b}) contrast(${e.c})`;
  const dw=im.naturalWidth*scale,dh=im.naturalHeight*scale;
  target.drawImage(im,-dw/2,-dh/2,dw,dh);
  target.restore();
  target.filter='none';

  if(overlay)target.drawImage(overlay,0,0,ow,oh);

  const project=$('project').value.trim(),custom=$('custom').value.trim();
  if(project||custom){
    const scaleUI=ow/W;
    target.fillStyle='#000b';target.fillRect(18*scaleUI,(H-58)*scaleUI,(W-36)*scaleUI,40*scaleUI);
    target.fillStyle='#fff';target.font=`bold ${13*scaleUI}px system-ui`;
    target.fillText(project,30*scaleUI,(H-35)*scaleUI);
    target.font=`${10*scaleUI}px system-ui`;
    target.fillText(custom,30*scaleUI,(H-19)*scaleUI);
  }
  return true;
}
async function drawPreview(){
  updateReadouts();
  const ok=await drawComposition(ctx,W,H);
  $('empty').style.display=(selected>=0&&ok)?'none':'block';
}

function chosenResolution(){
  const v=$('resolution').value;
  if(v==='original'&&selected>=0)return [photos[selected].width,photos[selected].height];
  if(v==='custom'){
    let w=Math.max(100,Math.min(8000,parseInt($('customW').value)||1920));
    let h=Math.max(100,Math.min(8000,parseInt($('customH').value)||1609));
    return [w,h];
  }
  const [w,h]=v.split('x').map(Number);return [w,h];
}
function outputName(){
  const prefix=($('project').value||'DOC').trim().replace(/[^\w-]+/g,'_')||'DOC';
  const n=String(selected+1).padStart(3,'0');
  return `${prefix}_${n}.jpg`;
}
async function exportCurrent(){
  if(selected<0){toast('Upload/select a photo first.');return}
  const [ow,oh]=chosenResolution();
  const out=document.createElement('canvas');out.width=ow;out.height=oh;
  const octx=out.getContext('2d',{alpha:false});
  const ok=await drawComposition(octx,ow,oh);
  if(!ok){toast('Could not render this photo.');return}
  out.toBlob(blob=>{
    if(!blob){toast('Export failed.');return}
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=outputName();document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    $('status').textContent=`Saved ${ow} × ${oh}`;
    toast(`Saved ${ow} × ${oh} JPG`);
  },'image/jpeg',.94);
}
$('save').onclick=exportCurrent;
$('resolution').onchange=()=>{
  const custom=$('resolution').value==='custom';
  $('customW').classList.toggle('hidden',!custom);$('customH').classList.toggle('hidden',!custom);$('times').classList.toggle('hidden',!custom);
};
$('reset').onclick=()=>{if(selected<0)return;photos[selected].e={z:1,x:0,y:0,r:0,b:1,c:1};select(selected)};

$('tpl').onclick=()=>$('modal').classList.remove('hidden');
$('closeTpl').onclick=()=>$('modal').classList.add('hidden');
$('templateFile').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  try{
    overlay=await loadImage(f);overlayURL=URL.createObjectURL(f);$('templatePreview').src=overlayURL;
    $('modal').classList.add('hidden');drawPreview();toast('Template loaded');
  }catch{toast('Template PNG could not be loaded')}
};

$('cam').onclick=async()=>{
  $('cameraModal').classList.remove('hidden');
  try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});$('video').srcObject=stream;liveDraw()}
  catch{toast('Camera needs browser permission and usually localhost/HTTPS')}
};
$('closeCam').onclick=()=>{$('cameraModal').classList.add('hidden');if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}};
function liveDraw(){if($('cameraModal').classList.contains('hidden'))return;const l=$('live'),x=l.getContext('2d');x.clearRect(0,0,W,H);if(overlay)x.drawImage(overlay,0,0,W,H);requestAnimationFrame(liveDraw)}
$('capture').onclick=()=>{
  const v=$('video');if(!v.videoWidth){toast('Camera is not ready yet');return}
  const q=document.createElement('canvas');q.width=W;q.height=H;const x=q.getContext('2d');
  const sc=Math.max(W/v.videoWidth,H/v.videoHeight),dw=v.videoWidth*sc,dh=v.videoHeight*sc;
  x.fillStyle='#000';x.fillRect(0,0,W,H);x.drawImage(v,(W-dw)/2,(H-dh)/2,dw,dh);if(overlay)x.drawImage(overlay,0,0,W,H);
  q.toBlob(async b=>{const f=new File([b],`CAM_${Date.now()}.jpg`,{type:'image/jpeg'});await addFiles([f]);toast('Camera photo added')},'image/jpeg',.94);
};

document.querySelectorAll('.tabs button').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.remove('active'));t.classList.add('active');
  $('edit').classList.toggle('hidden',t.dataset.tab!=='edit');$('info').classList.toggle('hidden',t.dataset.tab!=='info');
});
renderList();updateReadouts();
