import {z} from 'zod';
const option=z.object({label:z.string().min(1).max(2000),description:z.string().max(10000).optional()}).strict();
const item=z.object({id:z.string().min(1).max(200),question:z.string().min(1).max(20000),detail:z.string().max(200000).optional(),header:z.string().max(2000).optional(),options:z.array(option).max(30).optional(),multiSelect:z.boolean().optional(),intent:z.object({kind:z.literal('plan-review'),approve:z.string(),callId:z.string().optional()}).strict().optional()}).strict();
export function questionBatch(input){
 const {questions}=z.object({questions:z.array(item).min(1).max(10)}).strict().parse(input);
 if(new Set(questions.map(q=>q.id)).size!==questions.length)throw Error('Duplicate question id');
 for(const q of questions){const labels=(q.options??[]).map(o=>o.label);if(new Set(labels).size!==labels.length)throw Error('Duplicate option label');if(q.intent&&!labels.includes(q.intent.approve))throw Error('Invalid plan approval label');}
 return questions;
}
// A skipped batch is empty, never an implicit plan approval. Labels, not indices, encode decisions.
export function questionAnswer(questions,input){
 const answer=z.object({answers:z.array(z.object({id:z.string(),selected:z.array(z.string()).max(30),custom:z.string().max(20000).optional()}).strict()).max(10)}).strict().parse(input);
 const seen=new Set();for(const a of answer.answers){const q=questions.find(q=>q.id===a.id);if(!q||seen.has(a.id))throw Error('Unknown/duplicate question');seen.add(a.id);
  if(new Set(a.selected).size!==a.selected.length||a.selected.some(s=>!q.options?.some(o=>o.label===s)))throw Error('Unknown/duplicate option');
  if(!q.multiSelect&&(a.selected.length>1||(a.selected.length&&a.custom?.trim())))throw Error('Single select question accepts one choice or custom text');
 }
 return answer;
}
