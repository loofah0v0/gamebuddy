import {mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
/** Runtime owns admission/rollback. Only roll back an accepted update when file commit fails. */
export async function commitModelCredential({path,crypto,key,save,restore,files={mkdir,writeFile,rename,unlink}}){
 if(!crypto.isEncryptionAvailable())throw Error('系统凭据加密不可用，不会降级成明文存储');
 const bytes=crypto.encryptString(key),temp=path+'.tmp';
 await files.mkdir(dirname(path),{recursive:true});
 try{
  await files.writeFile(temp,bytes,{mode:0o600});
  const value=await save(); // Rejected admission must not invoke a second save / restart.
  try{await files.rename(temp,path);}catch(error){
   try{await restore();}catch(restoreError){throw new AggregateError([error,restoreError], '模型凭据提交失败，恢复未确认；请重新保存模型配置');}
   throw error;
  }
  return value;
 }finally{await files.unlink(temp).catch(()=>{});}
}
