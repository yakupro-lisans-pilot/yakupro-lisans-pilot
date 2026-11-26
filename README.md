# YAKUPRO 3.38.6 | Render Bulut Lisans Sunucusu (Pilot)

Bu klasor **yalnizca lisans sunucusu kaynak kodu** icerir. Ilan yayinlama motoru degistirilmemistir.

## Kurulum

1. `https://github.com/new` adresinde **Private** bir depo olustur. GitHub depo adina `yakupro-lisans-pilot` yazabilirsin. GitHub `README` dosyasini otomatik ekleme; dosyalar zaten mevcut.
2. Bu ZIP'i ayikla. **ZIP'i degil, icerisindeki dosyalari** GitHub depoda `Add file > Upload files` ile yukle ve `Commit changes` de. `render.yaml`, `server.js`, `store.js`, `admin.js` depodaki kok dizinde gorunmeli.
3. `https://dashboard.render.com/` adresinde hesap ac/giris yap, GitHub deposunu bagla.
4. `New > Blueprint` sec, ozel depoyu sec, `render.yaml` ile servisi olustur. **Blueprint ucretli plani ve 1 GB kalici diski tarif eder; onaylamadan once maliyeti gor.**
5. Dagitim tamamlaninca verilen `https://...onrender.com/v1/health` adresini tarayicida ac. `{ "ok": true }` iceren yanit beklenir.
6. Render servisinde **Shell** ac: `node admin.js create "Deneme Musteri" 30` ile yeni **bulut** lisansi olustur. Aktivasyon kodunu guvenli yere kaydet. Yereldeki `Ev Testi` lisansi otomatik tasinmaz.
7. Sunucunun HTTPS adresini, ayri verilen `SUNUCU_ADRESINI_EKLE.html` araciyla **bos** musteri eklentisine yerlestir. ZIP'i ayiklayip `manifest.json` bulunan klasoru Chrome'da `Paketlenmemis oge yukle` ile kur.
8. Sunucuda ilk aktivasyon ve ikinci profil engelleme testini tekrarla.

## Guvenlik

- **Musterilere Node.js, sunucu kaynak kodu, server data, lisans database veya admin.js VERME.** Sadece adresi ayarlanmis musteri eklentisini ver.
- `storage/licenses.json` bulut lisans verisini icerir. GitHub'a asla yukleme; baska yere guvenli yedekle. `node admin.js backup` komutu Render Shell'de calisinca yedegi kalici disk uzerine yazar, fakat farkli bir yere de **sifreli** harici yedek gerekir.
- Render'da Free web service kalici disk desteklemez. **Bu projede ucretsiz sunucu kullanma:** lisanslar redeployda kaybolabilir.
- `render.yaml` yalnizca 1 sunucu ornegi ve yerel JSON veri tabani icin tasarlandi. Yatay olceklendirme yapma.
- Kod ve etkinlestirme yetkileri bagimsiz guvenlik incelemesi olmadan nihai ticari urun olarak degerlendirilmemeli. Kurulum kimligi donanim kimligi degildir.
- `https://...onrender.com/v1/health` herkesce gorulebilir; yalnizca servis sagligini verir, lisans/anahtar yayinlamaz.
- Platformun depolama/faturalama ayarlarini Render panelinden ayrica dogrula.

## Yerel gelistirme/test

```bash
node -v
npm test
npm start
```

Yerel sunucu (varsayilan): `http://127.0.0.1:8787`; bulutta Render `PORT` ortam degiskenini tanimlar.
