/** Session-logged completion/event messages targeted to the calling agent. */
import { createUserMessage, type ContextFormed } from '@deepseek-ai/dsh-llm';
import type { Agent } from '@deepseek-ai/dsh-agent';
declare module '@deepseek-ai/dsh-llm' { interface MessageSourceMap { gameguy:{kind:'gameguy'} & ContextFormed } }
export function notify(agent:Agent|undefined,summary:string,text:string):void{if(!agent)return;const message=createUserMessage({source:{kind:'gameguy',form:'notice',summary:summary.slice(0,120)},content:[{type:'text',text}]});agent.steer(message);}
