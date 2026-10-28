import {CredentialProvider,credentialRef,parseCredentialKey} from '@deepseek-ai/dsh-credentials';
let bridge;
export function setCredentialBridge(value){bridge=value;}
export class EncryptedCredentials extends CredentialProvider {
 constructor(ctx){super(ctx);this.locks=new Map();}
 async request(action,input){if(!bridge)throw Error('Encrypted credential bridge unavailable');return bridge(action,input);}
 async resolve(ref){credentialRef(ref);const value=await this.request('get',{ref});if(value)return {value,source:'managed'};const env=process.env[ref];return env?{value:env,source:'environment'}:undefined;}
 async describe(ref){const current=await this.resolve(ref);return {configured:!!current,source:current?.source,writable:true};}
 async set(ref,value){credentialRef(ref);if(typeof value!=='string'||!value.length||value.length>16000)throw Error('Invalid credential');await this.request('set',{ref,value});this.notifyUpdated(ref);}
 async unset(ref){credentialRef(ref);await this.request('unset',{ref});this.notifyUpdated(ref);}
 async readRecord(key){parseCredentialKey(key);return this.request('read-record',{key});}
 async describeRecord(key){const v=await this.readRecord(key);return {configured:!!v,kind:v?.kind,writable:true};}
 async listRecords(){return this.request('list-records',{});}
 async modifyRecord(key,update){parseCredentialKey(key);const previous=this.locks.get(key)??Promise.resolve();const job=previous.catch(()=>{}).then(async()=>{const value=await update(await this.readRecord(key));if(value===undefined)return this.readRecord(key);await this.request('write-record',{key,value});this.notifyRecordUpdated(key);return value;});this.locks.set(key,job);try{return await job;}finally{if(this.locks.get(key)===job)this.locks.delete(key);}}
 async deleteRecord(key){parseCredentialKey(key);const previous=this.locks.get(key)??Promise.resolve();const job=previous.catch(()=>{}).then(async()=>{await this.request('write-record',{key});this.notifyRecordUpdated(key);});this.locks.set(key,job);try{await job;}finally{if(this.locks.get(key)===job)this.locks.delete(key);}}
}
export function apply(ctx){return new EncryptedCredentials(ctx);}
