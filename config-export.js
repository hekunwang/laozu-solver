// Recovery when the browser refuses storage. No service or OS integration.
window.openTalentTransfer=()=>{
  const api=window.laozuLocal;
  if(!api?.serialize)return;
  const dialog=document.createElement('dialog');
  dialog.className='config-export-dialog';
  dialog.setAttribute('aria-label','导出当前配置');
  const title=document.createElement('h3');title.textContent='导出当前配置';
  const text=document.createElement('textarea');
  text.setAttribute('aria-label','当前配置内容');text.rows=10;text.readOnly=true;
  text.value=JSON.stringify({format:'laozu-current-config-v1',state:api.serialize()});
  const note=document.createElement('p');note.textContent='可复制下面的配置，或下载备份文件。';
  const select=document.createElement('button');select.type='button';select.textContent='选中全部';
  select.onclick=()=>{text.focus();text.select();};
  const download=document.createElement('button');download.type='button';download.textContent='下载备份';
  download.onclick=()=>{
    const url=URL.createObjectURL(new Blob([text.value],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='laozu-current-config.json';
    a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const close=document.createElement('button');close.type='button';close.textContent='关闭';close.onclick=()=>dialog.close();
  dialog.append(title,note,text,select,download,close);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  document.body.append(dialog);dialog.showModal();
};
