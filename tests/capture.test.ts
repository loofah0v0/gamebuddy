import test from 'node:test';
import assert from 'node:assert/strict';
import {captureGameScreenshot,screenshotContent} from '../packages/core/src/capture.js';
function fixture(){
 let reads=0,saves=0;
 const attachment={attachmentId:'fixture',mediaType:'image/png',bytes:8,width:640,height:360,originalDimensions:{width:1280,height:720}};
 const services:any={attachments:{imageLimits:{mediaTypes:['image/png'],maxImageBytes:100,maxMessageImageBytes:100},saveImage:async()=>{saves++;return attachment;}},llm:{resolveModelInfo:async()=>({inputModalities:['text','image']})}};
 const ctx:any={get:(key:string)=>services[key]};
 const engine:any={screenshot:async(_s:AbortSignal,id:string)=>{assert.equal(id,'main');reads++;return Buffer.alloc(8);}};
 const exec:any={signal:new AbortController().signal,agent:{options:{provider:'test',model:'vision'},session:{requestHeader:()=>undefined}}};
 return {ctx,engine,exec,services,attachment,counts:()=>({reads,saves})};
}
test('screenshot rejects unknown/nonvision routes before device reads or attachment writes',async()=>{
 const f=fixture();f.services.llm.resolveModelInfo=async()=>({inputModalities:['text']});
 await assert.rejects(captureGameScreenshot(f.ctx,f.engine,'main',f.exec),/image input/);
 f.services.llm.resolveModelInfo=async()=>({});await assert.rejects(captureGameScreenshot(f.ctx,f.engine,'main',f.exec),/image input/);
 delete f.exec.agent;await assert.rejects(captureGameScreenshot(f.ctx,f.engine,'main',f.exec),/resolve/);
 assert.deepEqual(f.counts(),{reads:0,saves:0});
});
test('screenshot requires storage and deployment PNG admission',async()=>{
 const f=fixture();f.services.attachments.imageLimits.mediaTypes=[];
 await assert.rejects(captureGameScreenshot(f.ctx,f.engine,'main',f.exec),/accept PNG/);
 delete f.services.attachments;await assert.rejects(captureGameScreenshot(f.ctx,f.engine,'main',f.exec),/attachment service/);
 assert.deepEqual(f.counts(),{reads:0,saves:0});
});
test('native image content preserves original device pixels and durable attachment reference',async()=>{
 const f=fixture();let routed:any;f.exec.agent.session.requestHeader=()=>({config:{provider:'routed',model:'routed-vision'}});
 f.services.llm.resolveModelInfo=async(provider:string,model:string)=>{routed={provider,model};return {inputModalities:['image']};};
 const value=await captureGameScreenshot(f.ctx,f.engine,'main',f.exec);const content=screenshotContent(value);
 assert.deepEqual(routed,{provider:'routed',model:'routed-vision'});assert.deepEqual(value.deviceDimensions,{width:1280,height:720});
 assert.equal(content[1].type,'image');assert.deepEqual((content[1] as any).attachment,f.attachment);
 const envelope=JSON.parse((content[0] as any).text);assert.deepEqual(envelope.coordinateScale,{x:2,y:2});
 assert.deepEqual(f.counts(),{reads:1,saves:1});
});
test('oversized or cancelled capture is never saved',async()=>{
 const f=fixture();f.services.attachments.imageLimits.maxMessageImageBytes=7;
 await assert.rejects(captureGameScreenshot(f.ctx,f.engine,'main',f.exec),/byte limits/);assert.deepEqual(f.counts(),{reads:1,saves:0});
 const abort=new AbortController();abort.abort();f.exec.signal=abort.signal;
 await assert.rejects(captureGameScreenshot(f.ctx,f.engine,'main',f.exec));assert.deepEqual(f.counts(),{reads:1,saves:0});
});
