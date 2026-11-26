'use strict';
/* YAKUPRO license server - HTTPS required via reverse proxy outside loopback.
 * Admin operations are CLI-only; there is deliberately NO remote admin API.
 * License keys + recovery pins are randomly generated and hashed at rest.
 */
const http=require('node:http');
const {readDB,transaction,sha,recoveryPin,bearerToken,constantEq}=require('./store');
const PORT=Number(process.env.PORT||process.env.YAKUPRO_PORT||8787);
const HOST=process.env.YAKUPRO_HOST||'127.0.0.1';
const INSTALL_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_RE=/^YKPR-(?:[A-F0-9]{4}-){5}[A-F0-9]{4}$/;
const PIN_RE=/^YKPR-R-(?:[A-F0-9]{4}-){3}[A-F0-9]{4}$/;
const buckets=new Map();
const now=()=>new Date().toISOString();
function allowed(ip,limit,windowMs){
 const t=Date.now();let b=buckets.get(ip);
 if(!b||t-b.start>windowMs)b={start:t,count:0};
 b.count++;buckets.set(ip,b);
 if(buckets.size>4000)for(const [k,v] of buckets)if(t-v.start>windowMs)buckets.delete(k);
 return b.count<=limit;
}
const send=(res,code,obj)=>{
 res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
 res.end(JSON.stringify(obj));
};
class ApiError extends Error{constructor(code,message,httpCode=400){super(message);this.code=code;this.httpCode=httpCode;}}
const fail=(code,message,httpCode)=>{throw new ApiError(code,message,httpCode);};
function findSession(db,header,installId){
 const match=/^Bearer ([A-Za-z0-9_-]{30,150})$/.exec(header||'');
 if(!match||!INSTALL_RE.test(installId||''))fail('SESSION_INVALID','Lisans oturumu gecersiz. Yeniden etkinlestir.',401);
 const tokenHash=sha(match[1]);
 for(const lic of db.licenses){
  for(const act of lic.activations||[]){
   if(constantEq(tokenHash,act.token_hash)&&act.install_id===installId){return {lic,act};}
  }
 }
 fail('SESSION_INVALID','Lisans oturumu gecersiz veya baska bir kurulumda etkin.',401);
}
function activeOrFail(lic){
 if(lic.revoked)fail('REVOKED','Lisans iptal edilmis.',403);
 if(lic.expires_at&&Date.parse(lic.expires_at)<=Date.now())fail('EXPIRED','Lisans suresi dolmus.',403);
}
const view=lic=>({ok:true,license_id:lic.id,customer:lic.customer,plan:lic.plan,
 expires_utc:lic.expires_at||null,seat_limit:lic.max_seats,server_time:now()});
async function jsonBody(req){
 let text='';
 for await(const chunk of req){
  text+=chunk.toString('utf8');
  if(text.length>5000)fail('BODY_TOO_LARGE','Istek cok buyuk.',413);
 }
 try{
  const obj=JSON.parse(text);
  if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('bad json');
  return obj;
 }catch{fail('BAD_JSON','Gecersiz JSON.',400);}
}
async function handler(req,res){
 const origin=req.headers.origin;
 // Browsers running extensions send chrome-extension origins; this is not an auth control.
 if(origin){
  if(!/^chrome-extension:\/\/[a-p]{32}$/.test(origin))return send(res,403,{ok:false,code:'ORIGIN',message:'Origin gecersiz.'});
  res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
 }
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 if(req.method==='GET'&&req.url==='/v1/health')return send(res,200,{ok:true,product:'YAKUPRO',server_time:now()});
 if(req.method!=='POST'||!['/v1/activate','/v1/status','/v1/deactivate'].includes(req.url))
  return send(res,404,{ok:false,code:'NOT_FOUND',message:'Bu adres kullanilmiyor.'});
 const ip=req.socket.remoteAddress||'unknown';
 if(!allowed(ip+'|'+(req.url==='/v1/activate'?'activate':'other'),
    req.url==='/v1/activate'?25:3000,60000))
  return send(res,429,{ok:false,code:'RATE_LIMIT',message:'Cok fazla istek. Bir dakika sonra yeniden dene.'});
 try{
  const body=await jsonBody(req);
  let output;
  if(req.url==='/v1/activate'){
   const key=String(body.key||'').trim().toUpperCase();
   const pin=String(body.recovery_pin||'').trim().toUpperCase();
   const id=String(body.install_id||'');
   if(!KEY_RE.test(key)||!INSTALL_RE.test(id)||pin&&!PIN_RE.test(pin))
    fail('BAD_INPUT','Aktivasyon veya kurulum kodu bicimi gecersiz.');
   output=await transaction(db=>{
    const lic=db.licenses.find(x=>constantEq(x.key_hash,sha(key)));
    if(!lic)fail('BAD_KEY','Aktivasyon kodu bulunamadi.',401);
    activeOrFail(lic);
    lic.activations=lic.activations||[];
    let transferred=false;
    if(lic.activations.length>=lic.max_seats || lic.activations.some(x=>x.install_id===id)){
     if(!pin||!lic.recovery_hash||!constantEq(lic.recovery_hash,sha(pin)))
      fail('DEVICE_LIMIT','Lisans baska bir kurulumda aktif. Kurtarma kodunu gir veya lisans sahibinden cihazi bosaltmasini iste.',409);
     // A single-seat transfer invalidates the previous bearer token instantly.
     // Multiple-seat licenses release the oldest active seat.
     lic.activations.sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
     const existingIndex=lic.activations.findIndex(x=>x.install_id===id);
     lic.activations.splice(existingIndex>=0?existingIndex:0,1);
     transferred=true;
    }else if(pin){
     // Never let a stale recovery pin be used to reset an otherwise free license.
     fail('RECOVERY_NOT_NEEDED','Bos kurulum hakki var. Kurtarma kodu olmadan etkinlestir.');
    }
    const token=bearerToken(),newPin=recoveryPin();
    lic.activations.push({install_id:id,token_hash:sha(token),created_at:now(),last_seen_at:now()});
    lic.recovery_hash=sha(newPin);
    return {write:true,value:{...view(lic),token,recovery_pin:newPin,transferred}};
   });
  }else if(req.url==='/v1/status'){
   const id=String(body.install_id||'');
   const db=readDB(),session=findSession(db,req.headers.authorization,id);
   activeOrFail(session.lic);
   // Last-seen timestamps are optional for license validity and deliberately
   // not written on every publish step to reduce disk contention.
   output=view(session.lic);
  }else if(req.url==='/v1/deactivate'){
   const id=String(body.install_id||'');
   output=await transaction(db=>{
    const {lic,act}=findSession(db,req.headers.authorization,id);
    lic.activations=lic.activations.filter(a=>a!==act);
    // The recovery code remains secret and is rotated on next activation.
    return {write:true,value:{ok:true,message:'Kurulum koltugu serbest birakildi.'}};
   });
  }
  return send(res,200,output);
 }catch(e){
  if(e instanceof ApiError)return send(res,e.httpCode,{ok:false,code:e.code,message:e.message});
  console.error('YAKUPRO server internal error:',e.stack||e);
  return send(res,500,{ok:false,code:'SERVER_ERROR',message:'Sunucu hatasi. Sunucu gunlugunu kontrol edin.'});
 }
}
const server=http.createServer((req,res)=>{void handler(req,res);});
readDB();
server.listen(PORT,HOST,()=>console.log(`YAKUPRO lisans sunucusu hazir: http://${HOST}:${PORT}`));
