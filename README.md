# Sınav Haftası Asistanı — kurulum (ücretsiz)

Bu klasör asıl sitedir. Vercel'de çalışır, veriler Upstash (Redis) veritabanında 4 haneli kodun altında saklanır.
İkisi de ücretsiz plandadır, kart istemez.

## Dosyalar
- `index.html` → site
- `api/new.js` → yeni 6 haneli kod üretir
- `api/data.js` → kodun verisini okur/kaydeder
- `api/library.js` → herkese açık "Hazır kurullar" kütüphanesi
- `api/_lib.js` → veritabanı bağlantısı ve sınırlar (kod tahmin koruması: saatte 30 yanlış deneme)
- `package.json`

## Kurulum
1. **GitHub**: github.com → hesap aç → sağ üst `+` → **New repository** → adı `sinav-asistani` → **Create repository**.
2. Açılan sayfada **uploading an existing file** linki → bu klasördeki her şeyi (index.html, package.json, README.md ve **api klasörünün kendisini**) sürükle → **Commit changes**.
3. **Vercel**: vercel.com → **Sign Up** → **Continue with GitHub** (Hobby planı). **Add New… → Project** → `sinav-asistani` yanında **Import** → hiçbir ayarı değiştirmeden **Deploy**.
4. **Veritabanı**: Vercel'de projeyi aç → **Storage** sekmesi → **Create Database** → **Upstash** (Redis) → ücretsiz plan → oluştur → projeye **Connect**.
5. **Deployments** sekmesi → en üstteki → `⋯` → **Redeploy** (veritabanı bilgileri aktif olsun diye).
6. Proje sayfasındaki link (ör. `sinav-asistani.vercel.app`) senin siten.

## PDF Ayırıcı
Kitapçığı okuyan sayfa claude.ai'de: https://claude.ai/artifact/Ds98xGWsqprjqbzfDFFvtT
Oradan alınan kurul kodu, sitede **📥 Kurul kodu ekle**'ye yapıştırılır.

## Yönetici (isteğe bağlı)
Vercel → Settings → Environment Variables → `ADMIN_CODE` = kendi kodun. Böylece kütüphanedeki uygunsuz paylaşımları silebilirsin.
