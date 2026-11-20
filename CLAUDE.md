# Sınav Haftası Asistanı — CardiacAI (devir notu)

Tıp fakültesi öğrencileri için kurul (ders kurulu) sınav planlayıcısı. Yapay zeka dersi ödevi, grup adı **CardiacAI**.
Proje sahibi: Yasin (Türkçe, samimi ve kısa yazar; hızlı yazdığı için yazım hataları olur).

## Önemli çalışma kuralları
- **Yasin'in istemediği özelliği ekleme.** Bir şey eklemek gerekiyorsa önce sor ("ekleme demedim mi").
- Cevaplar Türkçe, kısa, adım adım. Değişiklikten sonra ne değiştiğini maddelerle söyle.
- Her değişikliği test et (headless Chrome + sahte API ile), sonra **main**'e push et. Netlify (ve Vercel) main'den otomatik yayınlar (~1 dk).

## Parçalar
| Parça | Nerede | Not |
|---|---|---|
| Asıl site | https://sinav-asistani.netlify.app (bu repo; `netlify.toml` + `netlify/functions/api.js` adaptörü `api/*.js`'i çalıştırır) | **vercel.app Türkiye'de engelli (USOM)**, bu yüzden Netlify'a taşındı |
| Eski adres | https://sinav-asistani-ten.vercel.app (Vercel, hâlâ çalışır ama TR'de VPN'siz açılmaz) | `index.html` + `api/` |
| PDF Ayırıcı | https://claude.ai/artifact/Ds98xGWsqprjqbzfDFFvtT | claude.ai artifact; Claude kitapçığı okuyup **kurul kodu** (KRL1.…) üretir. Kaynağı: `extras/pdf-ayirici/` |
| Eski claude.ai sürümü | https://claude.ai/artifact/Vfzzj8XBE6L9LVLFrU7Lvg | Artık asıl site Vercel. Kaynak aynı (`src/`), STANDALONE=false |

claude.ai artifact'lerini sadece Yasin'in kendi Claude hesabındaki bir oturum güncelleyebilir; herkese açıkken güncellenemez (önce paylaşımı kapatması gerekir).

## Dosya yapısı
- `src/sinav-asistani.html` → **tek kaynak dosya**. Düzenlemeyi burada yap.
- `python3 build.py` → `index.html`'i üretir (başına `window.STANDALONE=true` ekler). **index.html'i elle düzenleme.**
- `api/_lib.js` Upstash Redis REST bağlantısı, kod üretimi (4 karakter, `23456789ABCDEFGHJKMNPQRSTUVWXYZ`; eski 6 karakterliler de geçerli), hız sınırları.
- `api/new.js` yeni kod · `api/data.js` GET/PUT veri (sunucu sürümü `updatedAt`; PUT `base` farklıysa 409) · `api/library.js` herkese açık "Hazır kurullar" kütüphanesi (silme: paylaşan ya da env `ADMIN_CODE`; silinen 10 dk `lib:trash:ID`de durur → `POST {action:"restore"}` ile geri alınır; admin `ban:true` ile paylaşanı (kod + IP hash) `lib:banned` set'ine ekler, kaydı `lib:bans` hash; `?bans=1` liste, `POST {action:"unban",by}` kaldırır).
- Ortam değişkenleri (Netlify ve Vercel'de aynı): `KV_REST_API_URL`, `KV_REST_API_TOKEN` (Upstash), isteğe bağlı `ADMIN_CODE`.

## Uygulama mantığı (src içinde)
- Veri: `root = {folders:[kurul...], activeId, settings, kurulSort, kurulOrder}`; her kurul `{name, startDate, examDate, dailyHours, perLec, courses, topics, sessions, attend, absLimit, absMode, grade, archived, fromLib, manual, isDefault}`.
- Plan: `simulate()` — konu işlendiği günden önce plana girmez, aynı gün/dün işlenen öne alınır, günlük 2 saatlik parçalar, dersler karışık.
- Süre: `topicHours` = konunun ders saati × `perLec` × zorluk (0.75/1/1.4) veya elle girilen `hours`.
- Görünümler: home · add (Kurul ekle) · settings · faq · kurul (sekmeler: today/topics/program). Menü: `#drawer`.
- Kurul kodu: `encodeFolder/decodeFolder` (deflate-raw + base64url, `KRL1.`). Eşleştirme `matchFolder` kurul **numarasına** göre.
- Ayarlar `root.settings`: verdict, count, prio, quote, attend, theme (varsayılan koyu).

## Test
Sahte API: basit bir Python HTTP sunucusu `/api/new`, `/api/data`, `/api/library` taklit eder; Playwright ile `index.html` açılır. Sayfa hatası (`pageerror`) olmamalı.
