/** Only explicit public-browser URLs; never hand local/app/credential URLs to OS handlers. */
export function externalBrowserURL(value,appOrigin){
 if(typeof value!=='string'||value.length>16384||/[\u0000-\u001f\u007f]/.test(value))return null;
 try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.origin===appOrigin)return null;return u.href;}catch{return null;}
}
