/** Use only the live registry's ownership relation; persisted lineage is not authority. */
export function taskOwner(registry,roots,agent){
 if(!agent||registry.get(agent.id)!==agent)return undefined;
 const direct=roots.get(agent.id);
 if(direct&&registry.get(agent.id)===agent)return direct;
 const live=registry.list(),visited=new Set();let current=agent;
 while(current&&!visited.has(current)){
  visited.add(current);
  const parent=live.find(candidate=>registry.isOwnedBy(current.id,candidate));
  if(!parent)return undefined;
  const task=roots.get(parent.id);
  if(task)return task;
  current=parent;
 }
 return undefined;
}
export function runtimeCapabilities(ctx,agent){
 ctx=agent?.ctx??ctx;const services=Object.fromEntries(['agents','tools','sessions','fs','shell','sandboxPolicy','permissionPresets','jobs','skills','commands','subagents','userQuestions','planMode','goals','sessionPersistence','sessionQuery','mcpResources'].map(name=>[name,Boolean(ctx.get(name))]));
 return {profile:ctx.get('profileContext')?.name??'sdk',services,tools:ctx.get('tools').schemas(agent).map(t=>t.name).sort(),commands:agent&&ctx.get('commands')?ctx.get('commands').list(agent).map(c=>({name:c.name,description:c.description,input:c.input})):[],planMode:agent&&ctx.get('planMode')?ctx.get('planMode').get(agent):{active:false},limitations:['GameGuy composes native DSH client modules with its own game surface.','Search needs a configured provider; MCP resources service alone does not install MCP servers.','Generated arbitrary code uses native DSH permissions, not a MAA resource sandbox.']};
}
