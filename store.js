'use strict';
// Node.js 20+ only. No external packages. Private storage is NEVER served over HTTP.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const DATA_DIR=path.resolve(process.env.YAKUPRO_DATA_DIR||path.join(__dirname,'private_data'));
const DB=path.join(DATA_DIR,'licenses.json');
const LOCK=path.join(DATA_DIR,'licenses.lock');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function init(){
 fs.mkdirSync(DATA_DIR,{recursive:true,mode:0o700});
 if(!fs.existsSync(DB))writeDB({version:1,licenses:[]});
}
function readDB(){
 init();
 const db=JSON.parse(fs.readFileSync(DB,'utf8'));
 if(db.version!==1||!Array.isArray(db.licenses))throw Error('Lisans veritabani surumu desteklenmiyor.');
 return db;
}
function writeDB(db){
 fs.mkdirSync(DATA_DIR,{recursive:true,mode:0o700});
 const tmp=DB+'.'+process.pid+'.'+crypto.randomBytes(4).toString('hex')+'.tmp';
 fs.writeFileSync(tmp,JSON.stringify(db,null,2)+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});
 fs.renameSync(tmp,DB);
}
async function transaction(fn){
 init();let fd;
 for(let i=0;i<60;i++){
  try{fd=fs.openSync(LOCK,'wx',0o600);break;}
  catch(e){
   if(e.code!=='EEXIST')throw e;
   // A crashed server's stale lock can be removed after 60 seconds.
   try{if(Date.now()-fs.statSync(LOCK).mtimeMs>60000)fs.unlinkSync(LOCK);}catch{}
   await delay(50);
  }
 }
 if(fd===undefined)throw Error('Veritabani mesgul; islemi yeniden deneyin.');
 try{
  const db=readDB();
  const result=await fn(db);
  if(result?.write)writeDB(db);
  return result?.value;
 }finally{
  fs.closeSync(fd);
  try{fs.unlinkSync(LOCK);}catch{}
 }
}
const sha=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
const random=bytes=>crypto.randomBytes(bytes).toString('hex').toUpperCase();
const grouped=(s,n=4)=>s.match(new RegExp(`.{1,${n}}`,'g')).join('-');
const activationKey=()=> 'YKPR-'+grouped(random(12));
const recoveryPin=()=> 'YKPR-R-'+grouped(random(8));
const bearerToken=()=>crypto.randomBytes(32).toString('base64url');
const constantEq=(a,b)=>{
 if(!a||!b)return false;
 const aa=Buffer.from(a,'utf8'),bb=Buffer.from(b,'utf8');
 return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);
};
module.exports={DATA_DIR,DB,readDB,transaction,sha,activationKey,recoveryPin,bearerToken,constantEq};
