import {normalizeModel} from './model.mjs';

const DEFAULT_URL='https://api.deepseek.com';
const MAX_BYTES=1024*1024;
const TIMEOUT_MS=15000;
class ProbeError extends Error {}

// Draft probes are independent of the Agent/runtime and never persist settings.
export async function resolveModelKey(model,suppliedKey,savedModel,readKey){
 if(typeof suppliedKey!=='string'||suppliedKey.length>16000||/[\r\n\u0000]/.test(suppliedKey))throw Error('API Key 格式无效');
 const sameRoute=savedModel?.provider===model.provider&&savedModel?.baseURL===model.baseURL;
 return suppliedKey.trim()||(sameRoute?await readKey():'');
}

async function request(input,key,path,body,{fetchImpl=fetch,timeoutMs=TIMEOUT_MS,maxBytes=MAX_BYTES}={}){
 const model=normalizeModel(input);
 if(typeof key!=='string'||!key.trim())throw Error('请填写 API Key；留空仅能使用相同提供商与 API 地址的已存密钥');
 if(key.length>16000||/[\r\n\u0000]/.test(key))throw Error('API Key 格式无效');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs),started=Date.now();
 try{
  const response=await fetchImpl((model.baseURL||DEFAULT_URL)+path,{method:body?'POST':'GET',redirect:'error',signal:controller.signal,headers:{Authorization:'Bearer '+key,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body(model))}:{})});
  if(!response.ok){
   await response.body?.cancel();
   const hints={401:'认证失败，请检查 API Key',403:'访问被拒绝，请检查密钥权限或服务商策略',404:path==='/models'?'服务商未提供 /models 目录，请手动填写模型 ID':'未找到 Chat Completions 接口或选定模型，请检查 API 地址与模型 ID',429:'请求受限或额度不足，请查看服务商控制台'};
   throw new ProbeError(hints[response.status]||('模型服务返回 HTTP '+response.status+'，请检查服务商状态'));
  }
  if(Number(response.headers.get('content-length'))>maxBytes)throw new ProbeError('模型服务响应过大，已停止读取');
  const reader=response.body?.getReader();if(!reader)throw new ProbeError('模型服务返回空响应');
  const chunks=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw new ProbeError('模型服务响应过大，已停止读取');chunks.push(Buffer.from(value));}}
  finally{await reader.cancel().catch(()=>{});}
  let json;try{json=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ProbeError('模型服务未返回有效 JSON，请确认地址为 API 而不是网页');}
  return {json,model,latencyMs:Date.now()-started};
 }catch(error){
  // Never deliver arbitrary upstream bodies, headers, network errors or keys to renderer/logs.
  if(controller.signal.aborted)throw Error('模型服务请求超时（'+Math.round(timeoutMs/1000)+' 秒），请检查网络与 API 地址');
  if(error instanceof ProbeError)throw error;
  throw Error('无法连接模型 API；请检查地址、网络、证书。为保护密钥，不跟随重定向');
 }finally{clearTimeout(timer);controller.abort();}
}

export async function discoverModels(input,key,options){
 const {json,latencyMs}=await request({...input,model:input.model?.trim()||'catalog-probe'},key,'/models',null,options);
 if(!Array.isArray(json?.data))throw Error('模型目录格式不兼容，请手动填写模型 ID');
 if(json.data.length>1000)throw Error('模型目录超过 1000 项，请手动填写模型 ID');
 const models=[...new Set(json.data.map(item=>item?.id).filter(id=>typeof id==='string'&&id.trim()===id&&id.length>0&&id.length<=200&&!/[\u0000-\u001f\u007f]/.test(id)&&!id.includes(key)))].sort();
 if(json.data.length&&!models.length)throw Error('模型目录没有有效的模型 ID，请手动填写');
 return {models,count:models.length,latencyMs,apiConnectionVerified:false};
}

export async function verifyModelAPI(input,key,options){
 const {json,model,latencyMs}=await request(input,key,'/chat/completions',m=>({model:m.model,messages:[{role:'user',content:'Reply with OK only.'}],stream:false,max_tokens:16}),options);
 const message=json?.choices?.[0]?.message;
 if(json?.error||message?.role!=='assistant'||message.tool_calls?.length||!['content','reasoning_content'].some(field=>typeof message[field]==='string'&&message[field].trim()))throw Error('接口未返回有效的助手文本；认证或选定模型的 Chat Completions 兼容性尚未确认');
 return {apiConnectionVerified:true,model:model.model,latencyMs,scope:'single-chat-completion'};
}
