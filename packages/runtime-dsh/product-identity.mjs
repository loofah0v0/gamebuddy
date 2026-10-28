import {persona,productIdentity} from './persona.mjs';
// Only the old product-owned preset is migrated, in memory. User presets and safety/tool sections stay intact.
const legacyPrefix='You are GameGuy (GG), an independent game-centered AI agent built on the complete DSH SDK.';
export function isLegacyProductPersona(text){const normalized=text.replace(/\s+/g,' ').trim();return normalized.startsWith(legacyPrefix)||normalized.startsWith('You are GameGuy (GG), an independent game-centered AI agent.')||normalized.startsWith('# GameGuy Agent 行为规范');}
export function replaceLegacyProductPersona(assembly){
 return {...assembly,sections:assembly.sections.map(section=>section.name==='deployment:persona-prefix'&&typeof section.text==='string'&&isLegacyProductPersona(section.text)?{...section,text:persona}:section)};
}
export function installProductIdentity(ctx){
 ctx.effect(()=>ctx.systemPrompt.section({name:'gameguy:product-identity',order:10250,text:productIdentity,interpolate:false}));
 // Presets can shadow the deployment prefix; this product policy must not depend on first-bootstrap config.
 ctx.on('system-prompt/assemble',async(_assembly,_context,next)=>replaceLegacyProductPersona(await next()));
}
