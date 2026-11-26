'use strict';
/* Owner CLI only. No signing keys and no activation secrets are sent to clients by this tool.
 * IMPORTANT: create output is shown once, so store the activation code securely.
 */
const {readDB,transaction,sha,activationKey}=require('./store');
const crypto=require('node:crypto');
const args=process.argv.slice(2);
const help=`YAKUPRO 3.38.6 Lisans Yonetimi (Node.js 20+)\n\n`+
 `  node admin.js create "Musteri Unvani" 30 [koltuk_sayisi]\n`+
 `  node admin.js create "Musteri Unvani" suresiz [koltuk_sayisi]\n`+
 `  node admin.js list\n  node admin.js release LISANS_ID\n`+
 `  node admin.js revoke LISANS_ID\n  node admin.js extend LISANS_ID 30\n`+
 `  node admin.js backup\n\n`+
 `NOT: Aktivasyon kodu yalnizca olusturma sirasinda gorunur.\n`+
 `Kurtarma kodu ilk aktivasyonda musterinin eklentisinde gorunur.\n`;
function find(db,id){const lic=db.licenses.find(l=>l.id===id);
 if(!lic)throw Error('Lisans ID bulunamadi: '+id);return lic;}
async function main(){
 const op=args[0];
 if(op==='create'){
  const customer=String(args[1]||'').trim().slice(0,120);
  const days=String(args[2]||'');
  const seats=args[3]===undefined?1:Number(args[3]);
  if(!customer||!(days==='suresiz'||/^[1-9][0-9]{0,3}$/.test(days))||
    !Number.isSafeInteger(seats)||seats<1||seats>10)throw Error('Kullanim: '+help);
  const key=activationKey(),created=new Date();
  const expires=days==='suresiz'?null:new Date(created.getTime()+Number(days)*86400000).toISOString();
  const id='YL-'+crypto.randomBytes(5).toString('hex').toUpperCase();
  await transaction(db=>{
   db.licenses.push({id,key_hash:sha(key),customer,plan:days==='suresiz'?'suresiz':'sureli',
    max_seats:seats,created_at:created.toISOString(),expires_at:expires,revoked:false,
    recovery_hash:null,activations:[]});
   return {write:true,value:null};
  });
  console.log('\nLISANS OLUSTURULDU\nID: '+id+'\nMusteri: '+customer+'\nSure: '+days+
   '\nKoltuk sayisi: '+seats+'\nBITIS: '+(expires||'Suresiz')+'\nAKTIVASYON KODU: '+key+
   '\n\nBu kodu simdi guvenli bir yere kaydet. Server bunu geri gosteremez.\n');
 }else if(op==='list'){
  const db=readDB();
  console.table(db.licenses.map(l=>({ID:l.id,Musteri:l.customer,Plan:l.plan,
   Bitis:l.expires_at||'Suresiz',Aktif:(l.activations||[]).length+'/'+l.max_seats,
   Durum:l.revoked?'IPTAL':l.expires_at&&Date.parse(l.expires_at)<=Date.now()?'SURE_DOLDU':'ACIK'})));
 }else if(op==='release'){
  if(!args[1])throw Error(help);
  await transaction(db=>{const l=find(db,args[1]);l.activations=[];l.recovery_hash=null;
   return {write:true,value:null};});
  console.log('Tum aktif kurulumlar serbest birakildi. Lisans kodu degismedi.');
 }else if(op==='revoke'){
  if(!args[1])throw Error(help);
  await transaction(db=>{const l=find(db,args[1]);l.revoked=true;
   return {write:true,value:null};});
  console.log('Lisans iptal edildi. Iptal edilen lisans kodu yeniden kullanilamaz.');
 }else if(op==='extend'){
  if(!args[1]||!/^[1-9][0-9]{0,3}$/.test(String(args[2]||'')))throw Error(help);
  await transaction(db=>{const l=find(db,args[1]);if(l.plan==='suresiz')throw Error('Suresiz lisansa sure eklenemez.');
   const base=Math.max(Date.now(),Date.parse(l.expires_at||'')||0);
   l.expires_at=new Date(base+Number(args[2])*86400000).toISOString();
   return {write:true,value:l.expires_at};}).then(s=>console.log('Yeni bitis:',s));
 }else if(op==='backup'){
  const fs=require('node:fs'),path=require('node:path'),{DATA_DIR}=require('./store');
  const p=path.join(DATA_DIR,'licenses_backup_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
  fs.writeFileSync(p,JSON.stringify(readDB(),null,2),{mode:0o600,flag:'wx'});
  console.log('Yedek:',p);
 }else console.log(help);
}
main().catch(e=>{console.error('HATA:',e.message);process.exitCode=1;});
