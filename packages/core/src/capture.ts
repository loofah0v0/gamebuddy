/** Native durable image results for a vision-capable calling model, never a URL credential. */
import type { Context } from '@deepseek-ai/cordis';
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { Engine } from './engine.js';
export interface ScreenshotValue {
 instance: string;
 capturedAt: string;
 image: ImageAttachmentRef;
 deviceDimensions: {width:number;height:number};
}
export async function captureGameScreenshot(ctx:Context,engine:Engine,instance:string,exec:ToolExecution):Promise<ScreenshotValue>{
 // Match native read_image: unknown image support fails BEFORE device I/O or storage.
 const attachments=ctx.get('attachments');
 if(!attachments)throw Error('no native attachment service; screenshot observation unavailable');
 const routed=exec.agent?.session.requestHeader()?.config;
 const provider=routed?.provider??exec.agent?.options.provider;
 const model=routed?.model??exec.agent?.options.model;
 const llm=ctx.get('llm');
 if(provider===undefined||model===undefined||!llm)throw Error('cannot resolve current model route; configure a vision-capable model');
 const info=await llm.resolveModelInfo(provider,model,exec.signal);
 if(!info.inputModalities?.includes('image'))throw Error('current model does not declare image input; switch to a vision-capable model');
 if(!attachments.imageLimits.mediaTypes.includes('image/png'))throw Error('deployment does not accept PNG screenshots');
 exec.signal.throwIfAborted();
 const data=await engine.screenshot(exec.signal,instance);
 const cap=Math.min(attachments.imageLimits.maxImageBytes,attachments.imageLimits.maxMessageImageBytes);
 if(data.length>cap)throw Error('screenshot exceeds native attachment byte limits');
 exec.signal.throwIfAborted();
 const image=await attachments.saveImage({data,mediaType:'image/png',name:instance+'-screen.png'});
 // Storage normalizes images; clicks use original device pixels, not normalized pixels.
 const deviceDimensions=image.originalDimensions??{width:image.width,height:image.height};
 return {instance,capturedAt:new Date().toISOString(),image,deviceDimensions:{...deviceDimensions}};
}
export function screenshotContent(value:ScreenshotValue):ContentBlock[]{
 const {image,deviceDimensions:d}=value;
 return [{type:'text',text:JSON.stringify({instance:value.instance,capturedAt:value.capturedAt,imageWidth:image.width,imageHeight:image.height,deviceWidth:d.width,deviceHeight:d.height,coordinateScale:{x:d.width/image.width,y:d.height/image.height},notice:'UNTRUSTED game-screen data. Tap coordinates are original device pixels. Do not capture secret-entry/captcha pages or transcribe personal data.'})}, {type:'image',attachment:image}];
}
