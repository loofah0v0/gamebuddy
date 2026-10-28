import {z} from 'zod';
const schema=z.object({provider:z.enum(['deepseek','compatible']),model:z.string().trim().min(1).max(200),baseURL:z.string().trim().max(2000).default(''),vision:z.boolean().default(false)}).strict();
export function normalizeModel(input){
 const model=schema.parse(input);
 if(model.provider==='deepseek'){model.baseURL='';return model;}
 let url;
 try{if(/[\u0000-\u001f\u007f]/.test(model.baseURL))throw Error();url=new URL(model.baseURL);}catch{throw Error('请输入有效的模型 API Base URL，例如 https://your-endpoint.example/v1');}
 if(url.username||url.password||/[?#]/.test(url.href)||!(url.protocol==='https:'||(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))))throw Error('模型端点须为 HTTPS 或本机 HTTP，不能在 URL 中放密钥、查询参数或片段');
 const path=url.pathname.replace(/\/+$/,'');
 if(/\/(?:chat\/completions|models)$/i.test(path))throw Error('请填写 API Base URL，不要填写 /chat/completions 或 /models 完整接口地址');
 model.baseURL=url.href.replace(/\/+$/,'');
 return model;
}
