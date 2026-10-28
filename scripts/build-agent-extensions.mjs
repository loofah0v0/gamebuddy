// Application-owned presentation fork of the pinned DSH page. Never edit upstream files.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),base=join(root,'node_modules/@deepseek-ai/dsh-client-ui-plugin-manager');
const pkg=JSON.parse(await readFile(join(base,'package.json'),'utf8'));
if(pkg.version!=='0.2.1-rc.2')throw Error('Review advanced plugin page compatibility before upgrading DSH');
let text=await readFile(join(base,'lib/client.js'),'utf8');
for(const [from,to] of [['id: "@deepseek-ai/dsh-client-ui-plugin-manager"','id: "@gameguy/agent-extensions"'],['const PANEL_ID = "plugins";','const PANEL_ID = "agent-extensions";'],['activePanelId !== "plugins"','activePanelId !== PANEL_ID']]){
 if(text.split(from).length!==2)throw Error('DSH page relocation anchor changed: '+from);text=text.replace(from,to);
}
const start=text.indexOf('ctx.slots.inject("sidebar.panellist",'),end=text.indexOf('}, PluginsPanelIcon));',start);
if(start<0||end<start)throw Error('DSH navigation contract changed');
text=text.slice(0,start)+text.slice(end+'}, PluginsPanelIcon));'.length);
text=text.replace('//# sourceMappingURL=client.js.map','');
await writeFile(join(root,'packages/agent-extensions/client.js'),'// Generated from MIT-licensed DSH 0.2.1-rc.2; host/tools/config remain unchanged.\n'+text);
await writeFile(join(root,'packages/agent-extensions/LICENSE'),await readFile(join(base,'LICENSE')));

for(const [source,target] of [['typert.host.js','typert.mjs'],['typert.remote-client.js','remote.mjs']]){
 const code=(await readFile(join(base,'lib',source),'utf8')).replaceAll('@deepseek-ai/dsh-client-ui-plugin-manager','@gameguy/agent-extensions');
 await writeFile(join(root,'packages/agent-extensions',target),'// Generated presentation adapter metadata, rebased to its actual package owner.\n'+code);
}
