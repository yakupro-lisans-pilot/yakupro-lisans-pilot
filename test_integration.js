'use strict';
/* Fully local integration tests. Uses a disposable temp database. No network access required. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'yakupro-license-test-'));
const port=18121+Math.floor(Math.random()*4000);
const env={...process.env,YAKUPRO_DATA_DIR:tmp,YAKUPRO_PORT:String(port),YAKUPRO_HOST:'127.0.0.1'};
const base='http://127.0.0.1:'+port;
function admin(...args){return execFileSync(process.execPath,[path.join(__dirname,'admin.js'),...args],{env,encoding:'utf8'});}
const id=()=>require('node:crypto').randomUUID();
async function call(p,body={},token){
 const r=await fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
 return {status:r.status,...await r.json()};
}
async function main(){
 const created=admin('create','Deneme Musterisi','30');
 const key=created.match(/AKTIVASYON KODU: (YKPR-[A-F0-9-]+)/)?.[1];
 assert.ok(key,'CLI activation key');
 assert.ok(!fs.readFileSync(path.join(tmp,'licenses.json'),'utf8').includes(key),'key stored hashed');
 const child=spawn(process.execPath,[path.join(__dirname,'server.js')],{env,stdio:'pipe'});
 try{
  let healthy=false;
  for(let i=0;i<60;i++){
   try{const r=await fetch(base+'/v1/health');if(r.ok){healthy=true;break;}}catch{}
   await new Promise(r=>setTimeout(r,50));
  }
  assert.ok(healthy,'server healthy');
  const a=id(),b=id(),c=id();
  let r=await call('/v1/status',{install_id:a},'nope');
  assert.equal(r.status,401);
  r=await call('/v1/activate',{key:'YKPR-0000-0000-0000-0000-0000-0000',install_id:a});
  assert.equal(r.status,401);
  const first=await call('/v1/activate',{key,install_id:a});
  assert.equal(first.status,200);assert.ok(first.token);assert.ok(first.recovery_pin);
  assert.ok(!fs.readFileSync(path.join(tmp,'licenses.json'),'utf8').includes(first.recovery_pin),'pin hashed');
  r=await call('/v1/status',{install_id:a},first.token);
  assert.equal(r.status,200);assert.equal(r.customer,'Deneme Musterisi');
  r=await call('/v1/status',{install_id:b},first.token);
  assert.equal(r.status,401,'token bound to install ID');
  r=await call('/v1/activate',{key,install_id:b});
  assert.equal(r.status,409,'seat limit');
  r=await call('/v1/activate',{key,install_id:b,recovery_pin:'YKPR-R-0000-0000-0000-0000'});
  assert.equal(r.status,409,'bad recovery pin');
  const moved=await call('/v1/activate',{key,install_id:b,recovery_pin:first.recovery_pin});
  assert.equal(moved.status,200,'transfer works');assert.equal(moved.transferred,true);
  assert.notEqual(moved.recovery_pin,first.recovery_pin,'recovery rotated');
  r=await call('/v1/status',{install_id:a},first.token);
  assert.equal(r.status,401,'old token invalidated after transfer');
  r=await call('/v1/status',{install_id:b},moved.token);
  assert.equal(r.status,200,'new token active');
  r=await call('/v1/activate',{key,install_id:c,recovery_pin:first.recovery_pin});
  assert.equal(r.status,409,'old recovery pin invalidated');
  r=await call('/v1/deactivate',{install_id:b},moved.token);
  assert.equal(r.status,200,'seat released');
  r=await call('/v1/status',{install_id:b},moved.token);
  assert.equal(r.status,401,'deactivated invalid');
  const third=await call('/v1/activate',{key,install_id:c});
  assert.equal(third.status,200,'activate after deactivate');
  const licId=third.license_id;
  admin('revoke',licId);
  r=await call('/v1/status',{install_id:c},third.token);
  assert.equal(r.status,403);assert.equal(r.code,'REVOKED');
  const created2=admin('create','Expire Test','1');
  const key2=created2.match(/AKTIVASYON KODU: (YKPR-[A-F0-9-]+)/)?.[1];
  const d=id();const fresh=await call('/v1/activate',{key:key2,install_id:d});
  assert.equal(fresh.status,200);
  const db=JSON.parse(fs.readFileSync(path.join(tmp,'licenses.json'),'utf8'));
  const expired=db.licenses.find(l=>l.id===fresh.license_id);expired.expires_at='2020-01-01T00:00:00.000Z';
  fs.writeFileSync(path.join(tmp,'licenses.json'),JSON.stringify(db));
  r=await call('/v1/status',{install_id:d},fresh.token);
  assert.equal(r.status,403);assert.equal(r.code,'EXPIRED');
  console.log('PASS: code hashing, activation, online status, seat limit, transfer, rotated recovery, revoke, expiry, deactivation');
 }finally{child.kill();fs.rmSync(tmp,{recursive:true,force:true});}
}
main().catch(e=>{console.error('FAIL',e);process.exitCode=1;});
