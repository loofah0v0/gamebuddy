import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionProjection,selectionSchema,modelIdsSchema,routeId,descriptor} from '../packages/runtime-dsh/model-selection.mjs';
test('model schemas reject control IDs/extra fields and deduplicate directories',()=>{
 assert.deepEqual(modelIdsSchema.parse([' a ','b','a']),['a','b']);assert.throws(()=>selectionSchema.parse({provider:'x',model:'x\nY'}));assert.throws(()=>selectionSchema.parse({provider:'x',model:'x',key:'no'}));assert.throws(()=>modelIdsSchema.parse(Array(1001).fill('a')));
});
test('route identity uses provider/endpoint, never model choice or secret',()=>{
 const a={provider:'compatible',baseURL:'http://127.0.0.1:1/v1',model:'a',key:'one'};assert.equal(routeId(a),routeId({...a,model:'b',key:'two'}));assert.notEqual(routeId(a),routeId({...a,baseURL:'http://127.0.0.1:1/other'}));
 assert.deepEqual(descriptor('other',{model:'a',vision:true}).input,['text']);
});
test('native request projection preserves newer pending choice across older request header',()=>{
 const a={provider:'gameguy',model:'a'},b={provider:'gameguy',model:'b'},fold=selectionProjection.apply;
 let state=fold(selectionProjection.init(),{type:'plugin:gameguy/model-route',data:{routeId:'route',selection:a}});assert.deepEqual(state.pending,a);
 state=fold(state,{type:'request/header',data:{header:{config:a}}});assert.deepEqual(state.lastUsed,a);assert.equal(state.pending,null);
 state=fold(state,{type:'model/selection',data:b});state=fold(state,{type:'request/header',data:{header:{config:a}}});assert.deepEqual(state.pending,b);
 state=fold(state,{type:'request/header',data:{header:{config:b}}});assert.equal(state.pending,null);assert.deepEqual(state.lastUsed,b);
});
