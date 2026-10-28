import {z} from 'zod';
import {createHash} from 'node:crypto';
export const selectionSchema=z.object({provider:z.string().trim().min(1).max(100),model:z.string().trim().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+$/),reasoningEffort:z.string().min(1).max(100).optional()}).strict();
export const modelIdsSchema=z.array(selectionSchema.shape.model).max(1000).transform(ids=>[...new Set(ids)]);
export const routeId=model=>createHash('sha256').update(JSON.stringify([model.provider,model.baseURL||''])).digest('hex');
export const providerId=model=>model.provider==='compatible'?'gameguy':'deepseek-official';
export const descriptor=(id,model)=>({id,input:id===model.model&&model.vision?['text','image']:['text'],contextWindow:128000,maxTokens:4096});
export const sameSelection=(a,b)=>!!a&&!!b&&a.provider===b.provider&&a.model===b.model&&a.reasoningEffort===b.reasoningEffort;
// Native events are authoritative even when a pending choice has not made a request yet.
export const selectionProjection={key:'gameguyModel',stateVersion:1,stateSchema:z.object({routeId:z.string().nullable(),pending:selectionSchema.nullable(),lastUsed:selectionSchema.nullable()}),init:()=>({routeId:null,pending:null,lastUsed:null}),apply:(state,event)=>{
 if(event.type==='plugin:gameguy/model-route')return {...state,routeId:event.data.routeId,...(event.data.selection?{pending:selectionSchema.parse(event.data.selection)}:{})};
 if(event.type==='model/selection')return {...state,pending:selectionSchema.parse(event.data)};
 if(event.type==='request/header'){const c=event.data.header.config,lastUsed=selectionSchema.parse({provider:c.provider,model:c.model,...(c.reasoningEffort===undefined?{}:{reasoningEffort:String(c.reasoningEffort)})});return {...state,lastUsed,pending:sameSelection(state.pending,lastUsed)?null:state.pending};}
 return state;
}};
