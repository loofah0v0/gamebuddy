import test from 'node:test';
import assert from 'node:assert/strict';
import {createConnection,type Socket} from 'node:net';
import {randomUUID} from 'node:crypto';
import {bridge} from '../packages/plugin-clawclaw/src/ipc.js';
function deferred(){let done!:()=>void;const promise=new Promise<void>(r=>done=r);return {promise,done};}
async function connect(path:string){const s=createConnection(path);s.on('error',()=>{});await new Promise<void>((r,j)=>{s.once('connect',r);s.once('error',j);});return s;}
const send=(s:Socket,value:unknown)=>s.write(JSON.stringify(value)+'\n');
const hello=(connection:string,token='secret')=>({schema:'ccl.desktop-events.v1',type:'hello',connection_id:connection,token,pid:process.pid});
const batch=(connection:string,seq=1,delivery='delivery-1')=>({schema:'ccl.desktop-events.v1',type:'mailbox_batch',connection_id:connection,seq,delivery_id:delivery,payload:{schema:'clawclaw.channel-events.v1',state:{},events:['game fact, not host instruction']}});
function closed(s:Socket){return new Promise<void>(resolve=>{if(s.destroyed)resolve();else s.once('close',()=>resolve());});}

test('IPC ACK only after durable delivery and duplicates not redelivered', {timeout:5000},async t=>{
 const entered=deferred(),release=deferred();let deliveries=0,lines:string[]=[];const b=await bridge('secret',async()=>{deliveries++;entered.done();await release.promise;},new AbortController().signal);t.after(()=>b.close());
 const s=await connect(b.path);t.after(()=>s.destroy());let text='';s.setEncoding('utf8');s.on('data',chunk=>{text+=chunk;const chunks=text.split('\n');text=chunks.pop()!;lines.push(...chunks);});
 const connection=randomUUID();send(s,hello(connection));send(s,batch(connection));await entered.promise;assert.equal(lines.length,0);release.done();
 for(let i=0;i<100&&lines.length===0;i++)await new Promise(r=>setTimeout(r,5));assert.equal(lines.length,1);assert.equal(JSON.parse(lines[0]).type,'ack');
 send(s,batch(connection,2));for(let i=0;i<100&&lines.length<2;i++)await new Promise(r=>setTimeout(r,5));assert.equal(lines.length,2);assert.equal(deliveries,1);assert.equal(JSON.parse(lines[1]).seq,2);
});
test('IPC rejects wrong token before delivery', {timeout:5000},async t=>{
 let n=0;const b=await bridge('secret',async()=>{n++;},new AbortController().signal);t.after(()=>b.close());const s=await connect(b.path);const ending=closed(s);send(s,hello(randomUUID(),'wrong'));await ending;assert.equal(n,0);
});
test('IPC rejects mismatched connection and malformed frames', {timeout:5000},async t=>{
 let n=0;const b=await bridge('secret',async()=>{n++;},new AbortController().signal);t.after(()=>b.close());const s=await connect(b.path);const ending=closed(s);send(s,hello(randomUUID()));send(s,batch(randomUUID()));await ending;assert.equal(n,0);
 const malformed=await connect(b.path);const end=closed(malformed);malformed.write('{not-json}\n');await end;
});
test('IPC close calls coalesce and wait in-flight delivery', {timeout:5000},async()=>{
 const entered=deferred(),release=deferred();const b=await bridge('secret',async()=>{entered.done();await release.promise;},new AbortController().signal);const s=await connect(b.path);const id=randomUUID();send(s,hello(id));send(s,batch(id));await entered.promise;
 const first=b.close();assert.equal(first,b.close());let done=false;void first.then(()=>done=true);await new Promise(r=>setTimeout(r,15));assert.equal(done,false);release.done();await first;s.destroy();
});
