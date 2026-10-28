/** Validated resource policy; arbitrary MAA task JSON is never accepted. */
import { z } from 'zod';
import { emulatorSchema } from './emulator-config.js';
export const configSchema=z.object({
 maaDir:z.string().default('D:/Gameguy/external/maa'),python:z.string().default('python'),
 adbPath:z.string().default('D:/Gameguy/external/platform-tools/adb.exe'),
 address:z.string().regex(/^(127\.0\.0\.1|localhost):[0-9]{1,5}$/).refine(a=>{const port=Number(a.split(':')[1]);return port>=1&&port<=65535;},'ADB port must be 1..65535').default('127.0.0.1:16384'),
 emulator:emulatorSchema.optional(),
 connection:z.enum(['General','MuMuEmulator12','MuMuEmulator']).default('General'),
 clientType:z.enum(['Official','Bilibili']).default('Official'),
 basePlan:z.string().default(''),basePlanIndex:z.number().int().min(0).max(50).default(0),
 // Legacy base=true remains custom; conversational preparation distinguishes collection from shifts.
 baseMode:z.enum(['custom','normal']).default('custom'),
 baseThreshold:z.number().min(0).max(1).default(0.3),
 dormNotStationed:z.boolean().default(true),dormTrust:z.boolean().default(false),
 medicineLimit:z.number().int().min(0).max(10).default(0),
 expiringMedicineLimit:z.number().int().min(0).max(10).default(0),
 creditShopping:z.boolean().default(false),creditBlacklist:z.array(z.string().max(100)).max(30).default([]),
 onlyDiscount:z.boolean().default(true),maxFightTimes:z.number().int().min(1).max(50).default(5),
}).strict();
export type ArknightsConfig=z.infer<typeof configSchema>;
export const planSchema=z.object({
 startup:z.boolean().default(true),daily:z.boolean().default(true),friends:z.boolean().default(true),
 // Undefined mail retains old daily+mail behaviour; false means never collect mail.
 mail:z.boolean().optional(),
 base:z.boolean().default(false),baseCollect:z.boolean().default(false),shopping:z.boolean().default(false),
 fight:z.object({stage:z.string().regex(/^[A-Za-z0-9-]{1,30}$/),times:z.number().int().min(1).max(50),medicine:z.number().int().min(0).max(10).default(0),expiringMedicine:z.number().int().min(0).max(10).default(0)}).strict().optional(),
 roguelike:z.object({theme:z.enum(['Phantom','Mizuki','Sami','Sarkaz','JieGarden']),runs:z.number().int().min(1).max(3).default(1),difficulty:z.number().int().min(0).max(18).default(0)}).strict().optional(),
}).strict();
export interface MaaTask { type:string;params:Record<string,string|number|boolean|string[]> }
export function compileTasks(c:ArknightsConfig,input:unknown):MaaTask[]{
 const p=planSchema.parse(input),tasks:MaaTask[]=[];
 if(p.startup)tasks.push({type:'StartUp',params:{client_type:c.clientType,start_game_enabled:true}});
 if(p.baseCollect&&!p.base)throw Error('仅收取模式需要 base:true');
 if(p.base){
  if(p.baseCollect)tasks.push({type:'Custom',params:{task_names:['InfrastBegin']}});
  else{
  const params:MaaTask['params']={mode:c.baseMode==='normal'?0:10000,facility:['Mfg','Trade','Power','Control','Reception','Office','Dorm'],drones:'_NotUse',replenish:false,threshold:c.baseThreshold,dorm_notstationed_enabled:c.dormNotStationed,dorm_trust_enabled:c.dormTrust,continue_training:false};
  if(c.baseMode==='custom'){if(!c.basePlan)throw Error('请先配置并确认已有基建换班方案 basePlan，或选择普通自动换班');Object.assign(params,{filename:c.basePlan,plan_index:c.basePlanIndex});}
  tasks.push({type:'Infrast',params});
  }
 }
 if(p.fight){const f=p.fight;
  // MAA >=6.8 interprets any nonzero expiring_medicine as an expiry-day switch, NOT a count cap.
  if(f.expiringMedicine>0)throw Error('当前 MAA 临期药接口不能保证按瓶数限量，暂不支持自动使用临期药；请设为 0');
  if(f.times>c.maxFightTimes||f.medicine>c.medicineLimit||f.expiringMedicine>c.expiringMedicineLimit)throw Error('刷取或用药超过已授权策略');tasks.push({type:'Fight',params:{stage:f.stage,times:f.times,medicine:f.medicine,medicine_expire_days:0,stone:0,client_type:c.clientType,report_to_penguin:false,report_to_yituliu:false}});}
 if(p.shopping&&!c.creditShopping)throw Error('信用购物尚未授权');
 if(p.friends||p.shopping)tasks.push({type:'Mall',params:{visit_friends:p.friends,shopping:p.shopping,buy_first:[],blacklist:c.creditBlacklist,force_shopping_if_credit_full:false,only_buy_discount:c.onlyDiscount,credit_fight:false}});
 if(p.daily||p.mail)tasks.push({type:'Award',params:{award:p.daily,mail:p.mail??p.daily,recruit:false,orundum:false,mining:false,specialaccess:false}});
 if(p.roguelike)tasks.push({type:'Roguelike',params:{theme:p.roguelike.theme,mode:0,starts_count:p.roguelike.runs,difficulty:p.roguelike.difficulty,investment_enabled:false,use_support:false}});
 if(!tasks.length)throw Error('计划没有可执行步骤');return tasks;
}
