import { z } from 'zod';
export const configSchema=z.object({
 host:z.string().max(253).regex(/^$|^[a-zA-Z0-9._:-]+$/).default(''),port:z.number().int().min(1).max(65535).default(25565),
 username:z.string().regex(/^[A-Za-z0-9_]{3,16}$/).default('GameGuy'),auth:z.literal('offline').default('offline'),
 version:z.string().regex(/^\d+\.\d+(\.\d+)?$/).optional(),allowDig:z.boolean().default(false),maxDigBlocks:z.number().int().min(1).max(16).default(3),
}).strict();
export const planSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('observe'),seconds:z.number().int().min(1).max(120).default(10)}).strict(),
 z.object({action:z.literal('goto'),x:z.number().int().min(-30000000).max(30000000),y:z.number().int().min(-64).max(320),z:z.number().int().min(-30000000).max(30000000),range:z.number().int().min(1).max(4).default(2)}).strict(),
 z.object({action:z.literal('dig'),block:z.string().regex(/^[a-z_]{1,64}$/),count:z.number().int().min(1).max(16).default(1),radius:z.number().int().min(1).max(8).default(4)}).strict(),
]);
export function validatePlan(config:unknown,plan:unknown){const c=configSchema.parse(config),p=planSchema.parse(plan);if(!c.host)throw Error('请配置已授权 Minecraft Java 服务器');if(p.action==='dig'&&(!c.allowDig||p.count>c.maxDigBlocks))throw Error('挖掘没有授权或超过上限');return {c,p};}
