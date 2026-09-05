import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../src/cable-geometry/render-readiness.js',import.meta.url),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture() {
  // Node's EventTarget does not remove a boolean-capture registration consistently;
  // normalize the equivalent options object to model browser listener matching.
  class Target extends EventTarget {
    addEventListener(type,listener,options){super.addEventListener(type,listener,typeof options==='boolean'?{capture:options}:options);}
    removeEventListener(type,listener,options){super.removeEventListener(type,listener,typeof options==='boolean'?{capture:options}:options);}
  }
  const doc=new Target(),win=new Target(),digests=[];
  const box={textContent:JSON.stringify({inputs:{quantity:4},derived_geometry:{rows:2},captured_at:'fixture'})};
  const canvases=Object.fromEntries(['formation_canvas','trench_canvas','bend_canvas'].map(id=>[id,{id,width:900,height:400}]));
  doc.getElementById=id=>id==='snapshot_box'?box:canvases[id];
  let callback,disconnected=false;
  class Observer {constructor(fn){callback=fn;}observe(){}disconnect(){disconnected=true;}}
  const crypto={subtle:{digest:()=>new Promise((resolve,reject)=>digests.push({resolve,reject}))}};
  vm.runInNewContext(source,{document:doc,window:win,MutationObserver:Observer,CustomEvent,TextEncoder,crypto});
  function event(type,id) {const e=new Event(type);Object.defineProperty(e,'target',{value:{id}});doc.dispatchEvent(e);}
  return {win,box,digests,event,getState:()=>win.CableGeometryRender.getState(),
    mutate:()=>callback(),resolve:(n,byte=1)=>digests[n].resolve(new Uint8Array(32).fill(byte).buffer),
    get disconnected(){return disconnected;}};
}

test('a stale digest cannot mark a newer pending input ready',async()=>{
  const f=fixture();assert.equal(f.digests.length,1);
  f.event('input','circuit_qty');f.resolve(0);await settle();
  assert.equal(f.getState().state,'pending');assert.equal(f.getState().revision,0);
  f.mutate();f.resolve(1,2);await settle();
  assert.equal(f.getState().state,'ready');assert.equal(f.getState().revision,1);
  assert.equal(f.getState().snapshotSha256,'02'.repeat(32));
});

test('out-of-order completion and failure cannot overwrite the latest render',async()=>{
  const f=fixture();f.mutate();f.resolve(1,3);await settle();
  const latest=f.getState();f.digests[0].reject(Error('old digest failed'));await settle();
  assert.equal(f.getState(),latest);assert.equal(latest.state,'ready');
  f.mutate();f.mutate();f.resolve(3,4);await settle();f.resolve(2,5);await settle();
  assert.equal(f.getState().snapshotSha256,'04'.repeat(32));assert.equal(f.getState().revision,2);
});

test('unrelated changes and route-name blur change preserve ready state',async()=>{
  const f=fixture();f.resolve(0);await settle();const ready=f.getState();
  f.event('change','route_name');f.event('change','unrelated');f.event('input','unrelated');
  assert.equal(f.getState(),ready);
  f.event('change','formation_type');assert.equal(f.getState().state,'pending');
  // An actual snapshot DOM write completes even when its content is identical.
  f.mutate();f.resolve(1);await settle();assert.equal(f.getState().state,'ready');
  assert.equal(f.getState().revision,2);assert.equal(f.getState().snapshotSha256,ready.snapshotSha256);
});

test('disposing invalidates pending work while bfcache suspension preserves observation',async()=>{
  const f=fixture();const cached=new Event('pagehide');Object.defineProperty(cached,'persisted',{value:true});f.win.dispatchEvent(cached);
  assert.equal(f.disconnected,false);f.resolve(0);await settle();assert.equal(f.getState().state,'ready');
  f.event('input','route_name');f.mutate();f.win.dispatchEvent(new Event('pagehide'));f.resolve(1);await settle();
  assert.equal(f.disconnected,true);assert.equal(f.getState().state,'pending');
  const last=f.getState();f.event('input','circuit_qty');f.win.dispatchEvent(new Event('resize'));assert.equal(f.getState(),last);
});
