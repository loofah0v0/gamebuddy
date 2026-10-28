/** Overlay the complete sdk/dsh-base composition without duplicating native services. */
export function permissionRows(root,mode='workspace-write',officialSearch=false){
 if(!['read-only','workspace-write','danger-full-access'].includes(mode))throw Error('Unknown DSH permission mode');
 return [
  {id:'sandbox-policy',config:{mode,workspaceRoot:root}},
  {id:'approval',config:{policy:mode==='danger-full-access'?'never':'ask'}},
  {id:'permission',config:{presets:{
   'read-only':{sandbox:'read-only',approval:'ask'},
   'workspace-write':{sandbox:'workspace-write',approval:'ask'},
   'danger-full-access':{sandbox:'danger-full-access',approval:'never'},
  }}},
  {id:'web',config:{...(officialSearch?{searchProvider:'deepseek-official'}:{}),fetchProvider:'http'}},
  {id:'web-search-deepseek',disabled:!officialSearch,config:{apiKeyEnv:'DEEPSEEK_API_KEY'}},
  {id:'web-deepseek-api',disabled:!officialSearch,config:{apiKeyEnv:'DEEPSEEK_API_KEY'}},
 ];
}
