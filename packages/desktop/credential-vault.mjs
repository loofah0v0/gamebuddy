import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {credentialRef,parseCredentialKey} from '@deepseek-ai/dsh-credentials';
const MAX=1048576,own=(v,k)=>Object.hasOwn(v,k);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
export function validateRef(ref){if(typeof ref!=='string'||!ref.length||ref.length>256)throw Error('Invalid credential reference');credentialRef(ref);return ref;}
export function validateKey(key){if(typeof key!=='string'||key.length>512)throw Error('Invalid credential record key');parseCredentialKey(key);return key;}
const secret=value=>{if(typeof value!=='string'||!value.length||value.length>16000)throw Error('Invalid credential');return value;};
function json(value,seen=new Set(),depth=0){
 if(depth>64)throw Error('Credential JSON too deep');
 if(value===null||typeof value==='string'||typeof value==='boolean')return;
 if(typeof value==='number'&&Number.isFinite(value))return;
 if(typeof value!=='object'||value===null||seen.has(value)||(!Array.isArray(value)&&!plain(value)))throw Error('Invalid credential JSON');
 seen.add(value);for(const [k,v] of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(k))throw Error('Unsafe credential JSON key');json(v,seen,depth+1);}seen.delete(value);
}
export function validateRecord(v){
 if(!plain(v)||!['api-key','grant'].includes(v.kind))throw Error('Invalid credential record');
 const allowed=v.kind==='api-key'?['kind','key','env']:['kind','payload'];
 if(Object.keys(v).some(k=>!allowed.includes(k)))throw Error('Unknown credential record field');
 if(v.kind==='api-key'){
  if(own(v,'key'))secret(v.key);
  if(own(v,'env')){if(!plain(v.env))throw Error('Invalid credential environment');for(const [k,value] of Object.entries(v.env)){validateRef(k);if(typeof value!=='string'||value.length>16000)throw Error('Invalid credential environment value');}}
 }else if(!own(v,'payload'))throw Error('Missing grant payload');
 json(v);if(JSON.stringify(v).length>MAX)throw Error('Credential record too large');return structuredClone(v);
}
function validateVault(d){
 if(!plain(d)||d.version!==1||!plain(d.refs)||!plain(d.records)||Object.keys(d).some(k=>!['version','refs','records'].includes(k)))throw Error('Invalid credential vault');
 const refs=Object.create(null),records=Object.create(null);
 for(const [ref,v] of Object.entries(d.refs))refs[validateRef(ref)]=secret(v);
 for(const [key,v] of Object.entries(d.records))records[validateKey(key)]=validateRecord(v);
 return {version:1,refs,records};
}
/** Main-process only. Validated, bounded encrypted records; serialized atomic writes. */
export class CredentialVault {
 constructor(dir,crypto){this.path=join(dir,'native-credentials.bin');this.dir=dir;this.crypto=crypto;this.tail=Promise.resolve();}
 async read(){try{if(!this.crypto.isEncryptionAvailable())throw Error('System credential encryption unavailable');const bytes=await readFile(this.path);if(bytes.length>16*MAX)throw Error('Credential vault too large');const text=this.crypto.decryptString(bytes);if(text.length>8*MAX)throw Error('Credential vault too large');return validateVault(JSON.parse(text));}catch(e){if(e.code==='ENOENT')return validateVault({version:1,refs:{},records:{}});throw e;}}
 request(action,input={}){const job=this.tail.catch(()=>{}).then(async()=>{if(!plain(input))throw Error('Invalid credential input');const d=await this.read();let write=false;const ref=input.ref,key=input.key;
 switch(action){
 case 'get':validateRef(ref);return own(d.refs,ref)?d.refs[ref]:undefined;
 case 'set':validateRef(ref);d.refs[ref]=secret(input.value);write=true;break;
 case 'unset':validateRef(ref);delete d.refs[ref];write=true;break;
 case 'read-record':validateKey(key);return own(d.records,key)?structuredClone(d.records[key]):undefined;
 case 'list-records':return Object.entries(d.records).map(([key,v])=>({key,kind:v.kind}));
 case 'write-record':validateKey(key);if(input.value===undefined)delete d.records[key];else d.records[key]=validateRecord(input.value);write=true;break;
 default:throw Error('Unsupported credential action');
 }
 if(write){if(!this.crypto.isEncryptionAvailable())throw Error('System credential encryption unavailable; plaintext fallback forbidden');const text=JSON.stringify(d);if(text.length>8*MAX)throw Error('Credential vault too large');await mkdir(this.dir,{recursive:true});await writeFile(this.path+'.tmp',this.crypto.encryptString(text),{mode:0o600});await rename(this.path+'.tmp',this.path);}return undefined;});this.tail=job;return job;}
}
