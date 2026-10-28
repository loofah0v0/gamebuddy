import { type GamePlugin,type Json,type GameRuntime } from '@gameguy/core';
import mineflayer, { type Bot } from 'mineflayer';
import pathfinding from 'mineflayer-pathfinder';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { configSchema,planSchema,validatePlan } from './plan.js';
import { z } from 'zod';
export const name='gameguy-minecraft';
export function state(bot:Bot):Json {return {position:bot.entity?.position?{x:bot.entity.position.x,y:bot.entity.position.y,z:bot.entity.position.z}:null,health:bot.health??null,food:bot.food??null,inventory:bot.inventory.items().map(i=>({name:i.name,count:i.count})),players:Object.keys(bot.players).slice(0,50)};}
export async function execute(config:Json,plan:Json,runtime:GameRuntime):Promise<Json>{
 const {c,p}=validatePlan(config,plan);if(runtime.signal.aborted)throw Error('cancelled');
 const bot=mineflayer.createBot({...c,version:c.version,hideErrors:true});
 let alive=true;
 const check=()=>{if(!alive||runtime.signal.aborted)throw Error('Minecraft activity cancelled/disconnected');};
 let rejectFailure!:(e:Error)=>void;
 const failure=new Promise<never>((_,reject)=>{rejectFailure=reject;});void failure.catch(()=>{});
 const end=(reason:string)=>{alive=false;rejectFailure(Error('Minecraft disconnected: '+String(reason).slice(0,200)));};
 const error=(e:Error)=>{alive=false;rejectFailure(Error('Minecraft error: '+e.message.slice(0,200)));};
 const abort=()=>{alive=false;bot.pathfinder?.stop();bot.clearControlStates();bot.quit();rejectFailure(Error('Minecraft stopped; last action may have taken effect'));};
 bot.on('error',error);bot.on('end',end);runtime.signal.addEventListener('abort',abort,{once:true});
 let tick:NodeJS.Timeout|undefined,spawnTimer:NodeJS.Timeout|undefined;
 try{
  const spawned=new Promise<void>(resolve=>bot.once('spawn',resolve));
  const timeout=new Promise<never>((_,reject)=>{spawnTimer=setTimeout(()=>reject(Error('Minecraft spawn deadline exceeded')),20000);});
  await Promise.race([spawned,failure,timeout]);clearTimeout(spawnTimer);
  bot.loadPlugin(pathfinding.pathfinder);const movement=new pathfinding.Movements(bot);movement.canDig=false;movement.allow1by1towers=false;movement.allowParkour=false;movement.scafoldingBlocks=[];bot.pathfinder.setMovements(movement);
  runtime.event('minecraft-state',state(bot));tick=setInterval(()=>runtime.event('minecraft-state',state(bot)),2000);
  let count=0;
  const action=async()=>{
   if(p.action==='observe')await new Promise<void>(resolve=>{const timer=setTimeout(resolve,p.seconds*1000);failure.catch(()=>{clearTimeout(timer);resolve();});});
   else if(p.action==='goto')await bot.pathfinder.goto(new pathfinding.goals.GoalNear(p.x,p.y,p.z,p.range));
   else for(let i=0;i<p.count;i++){
    check();
    const block=bot.findBlock({matching:b=>b.name===p.block,maxDistance:p.radius});if(!block)throw Error('no matching visible block in bounded radius');
    await bot.pathfinder.goto(new pathfinding.goals.GoalNear(block.position.x,block.position.y,block.position.z,2));
    check();
    await bot.dig(block);check();count++;runtime.event('minecraft-dig',{block:p.block,count});
   }
  };
  await Promise.race([action(),failure]);if(runtime.signal.aborted)throw Error('cancelled');
  return {outcome:'backend-completed',action:p.action,blocksDug:count,state:state(bot),rewardVerification:'not independently verified'};
 }finally{alive=false;if(spawnTimer)clearTimeout(spawnTimer);if(tick)clearInterval(tick);runtime.signal.removeEventListener('abort',abort);bot.pathfinder?.stop();bot.clearControlStates();bot.quit();}
}
export const adapter:GamePlugin={id:'minecraft',title:'Minecraft · Mineflayer',defaults:configSchema.parse({}),parseConfig:i=>configSchema.parse(i),questions:config=>configSchema.parse(config).host?[]:['服务器地址、端口和授权（Minecraft Java；MVP 仅支持已授权 offline-mode 服务器）'],
 configSchema:z.toJSONSchema(configSchema) as Json,planSchema:z.toJSONSchema(planSchema) as Json,
 capabilities:{schedule:false},validatePlan:(config,plan)=>validatePlan(config,plan).p,
 setup:async config=>({suggestedConfig:configSchema.parse(config),questions:configSchema.parse(config).host?[]:['已授权的 Minecraft Java offline-mode 服务器地址、端口及版本？'],ready:false,next:'确认服务器授权后 configure；连接配置不要求先选择挖掘任务。'}),
 diagnose:async(config,signal)=>{signal?.throwIfAborted();const c=configSchema.parse(config);if(!c.host)return {ready:false,detail:'server not configured'};return new Promise<Json>(resolve=>{const s=createConnection({host:c.host,port:c.port});let done=false;const finish=(ready:boolean)=>{if(done)return;done=true;signal?.removeEventListener('abort',cancel);s.destroy();resolve({ready,detail:ready?'TCP reachable; not proof of login or version compatibility':'TCP unavailable',auth:'offline only'});};const cancel=()=>finish(false);signal?.addEventListener('abort',cancel,{once:true});s.setTimeout(3000);s.once('connect',()=>finish(true));s.once('timeout',()=>finish(false));s.once('error',()=>finish(false));});},execute};
