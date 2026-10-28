/** Pure, plugin-owned player-intent compiler. No files, devices or persisted policy writes. */
import { z } from 'zod';
import { configSchema, planSchema, compileTasks } from './plan.js';
export const requestSchema=z.object({
 intent:z.enum(['connect','daily','rewards','base','farm','credit','roguelike']),
 daily:z.boolean().optional(),mail:z.boolean().optional(),friends:z.boolean().optional(),
 base:z.object({mode:z.enum(['collect','normal','custom']).default('collect'),threshold:z.number().min(0).max(1).optional(),dormNotStationed:z.boolean().optional(),dormTrust:z.boolean().optional(),filename:z.string().min(1).max(1000).optional(),planIndex:z.number().int().min(0).max(50).optional()}).strict().optional(),
 shopping:z.boolean().optional(),
 creditPolicy:z.object({blacklist:z.array(z.string().min(1).max(100)).max(30).optional(),onlyDiscount:z.boolean().optional(),strictDiscountOnly:z.boolean().optional()}).strict().optional(),
 fight:z.object({stage:z.string().regex(/^[A-Za-z0-9-]{1,30}$/).optional(),times:z.number().int().min(1).max(50).optional(),medicine:z.number().int().min(0).max(10).default(0),expiringMedicine:z.number().int().min(0).max(10).default(0)}).strict().optional(),
 roguelike:z.object({theme:z.enum(['Phantom','Mizuki','Sami','Sarkaz','JieGarden']).optional(),runs:z.number().int().min(1).max(3).default(1),difficulty:z.number().int().min(0).max(18).default(0)}).strict().optional(),
}).strict();
export function preparePlan(config:unknown,request:unknown){
 const original=configSchema.parse(config),c={...original,creditBlacklist:[...original.creditBlacklist]},r=requestSchema.parse(request);
 const questions:string[]=[],warnings:string[]=[],summary:string[]=[],unsupported:string[]=[];
 const changes=()=>Object.keys(c).filter(k=>JSON.stringify(c[k as keyof typeof c])!==JSON.stringify(original[k as keyof typeof c])).map(field=>({field,before:original[field as keyof typeof original]??null,after:c[field as keyof typeof c]??null}));
 if(r.intent==='connect'){
  if(Object.keys(r).some(k=>k!=='intent'))throw Error('连接需求不能附带游戏操作，请分开准备计划');
  return {ready:true,scope:'configuration-only',proposedConfig:c,plan:null,tasks:[],questions,warnings,unsupported,summary:['仅准备连接配置；设备实例与渠道以环境发现和玩家确认结果为准，不执行游戏。'],changes:changes(),needsConfigApproval:false};
 }
 const daily=r.daily??(r.intent==='daily'||r.intent==='rewards'),mail=r.mail??daily;
 const p=planSchema.parse({startup:true,daily,mail,friends:r.friends??(r.intent==='daily'||r.intent==='credit'),base:!!r.base||r.intent==='base',shopping:r.shopping??false});
 if(p.base){
  const b=r.base??{mode:'collect' as const};
  if(b.mode==='collect'){
   if(Object.keys(b).some(k=>k!=='mode'))throw Error('仅收取基建不接受换班阈值、宿舍选人或方案文件');
   p.baseCollect=true;
   summary.push('仅收取基建通知面板中的产出、订单与信赖；不换班、不点一键轮换、不处理线索，不用无人机、不补原料。订单交付会消耗正常的基建订单货物。');
  }else{
  c.baseMode=b.mode;
  if(b.threshold!==undefined)c.baseThreshold=b.threshold;
  if(b.dormNotStationed!==undefined)c.dormNotStationed=b.dormNotStationed;
  if(b.dormTrust!==undefined)c.dormTrust=b.dormTrust;
  if(b.mode==='custom'){
   if(b.filename)c.basePlan=b.filename;
   if(b.planIndex!==undefined)c.basePlanIndex=b.planIndex;
   if(!c.basePlan)questions.push('你已有换班方案文件吗？可以选择普通自动换班，不需要提供文件。');
   summary.push('按已有自定义方案换班；运行前校验所选方案，不允许方案启用无人机。');
  }else{
   if(b.filename!==undefined||b.planIndex!==undefined)throw Error('普通自动换班不使用方案文件或索引');
   summary.push('普通自动换班：由 MAA 选择干员，可能改变当前阵容，不保证最优排班。');
  }
  }
 }
 if(r.fight||r.intent==='farm'){
  const f=r.fight??{medicine:0,expiringMedicine:0};
  if(!f.stage)questions.push('要刷哪个已解锁、可代理的关卡？例如 1-7；只说材料名称时需要先确定关卡。');
  if(f.times===undefined)questions.push('这次最多刷几次？支持 1–50 次，理智不足且不吃药时可能提前结束。');
  if(f.expiringMedicine>0){unsupported.push('按瓶数限量使用临期药');questions.push('MAA 临期药参数不是瓶数上限，暂不能保证限量。是否改为不使用临期药？');}
  c.maxFightTimes=Math.max(c.maxFightTimes,f.times??0);c.medicineLimit=Math.max(c.medicineLimit,f.medicine);
  if(f.stage&&f.times!==undefined)p.fight={stage:f.stage,times:f.times,medicine:f.medicine,expiringMedicine:0};
  if(f.stage&&f.times!==undefined)summary.push(`代理 ${f.stage} 最多 ${f.times} 次，普通理智药最多 ${f.medicine} 瓶，临期药 0，源石 0。`);
 }
 if(r.roguelike||r.intent==='roguelike'){
  const rogue=r.roguelike??{runs:1,difficulty:0};
  if(!rogue.theme)questions.push('要玩哪个肉鸽主题？傀影、水月、萨米、萨卡兹或界园；还需当前游戏和 MAA 支持。');
  else{p.roguelike={theme:rogue.theme,runs:rogue.runs,difficulty:rogue.difficulty};summary.push(`肉鸽 ${rogue.theme} 最多启动 ${rogue.runs} 局，难度 ${rogue.difficulty}；不保证通关。`);}
 }
 if(p.shopping){
  if(r.creditPolicy?.strictDiscountOnly){unsupported.push('严格仅买折扣信用商品');questions.push('MAA 的折扣参数不能保证只买折扣。是否只领取信用、不购物？');p.shopping=false;}
  else{c.creditShopping=true;if(r.creditPolicy?.blacklist)c.creditBlacklist=[...r.creditPolicy.blacklist];if(r.creditPolicy?.onlyDiscount!==undefined)c.onlyDiscount=r.creditPolicy.onlyDiscount;
   summary.push('启用信用购物（不涉及付费）；按黑名单执行，不能保证全部商品打折。');warnings.push('当前购物接口没有本次信用花费数值上限；余额允许时可能购买多项。只买某件/严格折扣/限定预算不可猜测实现。');}
 }else if(r.creditPolicy)throw Error('购物策略需要明确 shopping:true；仅领取信用无需购物策略');
 if(p.friends)summary.push('访问好友并领取信用；访问好友不等于授权购物。');
 if(p.daily)summary.push('领取日常与周常奖励，不代做未完成任务。');
 if(p.mail)summary.push('领取邮件。');
 if(!p.daily&&!p.mail&&!p.friends&&!p.base&&!p.shopping&&!p.fight&&!p.roguelike&&!questions.length)questions.push('这次希望做哪项操作：领取、换班、刷关、信用或肉鸽？');
 const delta=changes(),ready=questions.length===0;
 return {ready,scope:'gameplay-proposal',proposedConfig:configSchema.parse(c),plan:ready?p:null,tasks:ready?compileTasks(c,p):[],questions,warnings,unsupported,summary,
  changes:delta,needsConfigApproval:delta.length>0,
  resourcePolicy:{medicine:p.fight?.medicine??0,expiringMedicine:0,stone:0,shopping:p.shopping,drones:false,replenish:false,freeRecruit:false},
  prerequisite:'计划可编译不等于已连接、已登录或已获运行授权；环境诊断与执行审批另行进行。'};
}
