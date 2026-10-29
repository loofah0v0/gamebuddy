'use strict';
// Only a loading/recovery surface: the actual workspace is always loaded by the host.
const api=window.gameguy;
const $=id=>document.getElementById(id);
let snapshot=null,modelInitialized=false,sequence=0,busy=false;
function render(state){
 snapshot=state;
 const failed=typeof state.startupError==='string'&&state.startupError.length>0;
 document.body.dataset.stage=failed?'error':'loading';
 $('heading').textContent=failed?'GameBuddy 未能启动':'正在启动 GameBuddy';
 $('description').textContent=failed?'工作台暂时不可用，可查看错误并重新启动。':'正在准备你的工作台，请稍候。';
 $('diagnostic').hidden=!failed;$('error').textContent=failed?state.startupError.slice(0,2000):'';
 $('actions').hidden=!failed;$('retry').hidden=!failed||!state.tasks||state.runtime!=='ready';
 $('model-recovery').hidden=!failed||!state.tasks||!state.model;
 if(!modelInitialized&&state.model){
  $('provider').value=state.model.provider==='compatible'?'compatible':'deepseek';
  $('base-url').value=state.model.baseURL??'';$('model-id').value=state.model.model??'';
  updateProvider();modelInitialized=true;
 }
}
function updateProvider(){const deepseek=$('provider').value==='deepseek';$('base-url').disabled=deepseek;if(deepseek)$('base-url').value='';}
async function refresh(){const id=++sequence;try{const state=await api.invoke('state');if(id===sequence)render(state);}catch(error){if(id===sequence)render({startupError:'无法读取启动状态：'+error.message});}}
function setBusy(value){busy=value;for(const id of ['retry','restart','save-model'])$(id).disabled=value;}
async function act(action){if(busy)return;setBusy(true);$('action-error').hidden=true;try{await api.invoke(action);}catch(error){$('action-error').textContent=error.message;$('action-error').hidden=false;}finally{setBusy(false);}}
$('retry').addEventListener('click',()=>void act('retry-native'));
$('restart').addEventListener('click',()=>void act('restart'));
$('provider').addEventListener('change',()=>{if($('provider').value==='compatible')$('base-url').value='';updateProvider();});
$('model-form').addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;setBusy(true);$('model-error').hidden=true;
 try{await api.invoke('model',{model:{provider:$('provider').value,baseURL:$('base-url').value.trim(),model:$('model-id').value.trim(),vision:snapshot?.model?.vision===true},key:$('api-key').value});$('api-key').value='';}
 catch(error){$('model-error').textContent=error.message;$('model-error').hidden=false;}finally{setBusy(false);}
});
api.onRefresh(()=>void refresh());void refresh();
