# Sınav Haftası Asistanı — CardiacAI (devir notu)

Tıp fakültesi öğrencileri için kurul (ders kurulu) sınav planlayıcısı. Yapay zeka dersi ödevi, grup adı **CardiacAI**.
Proje sahibi: Yasin (Türkçe, samimi ve kısa yazar; hızlı yazdığı için yazım hataları olur).

## Önemli çalışma kuralları
- **Yasin'in istemediği özelliği ekleme.** Bir şey eklemek gerekiyorsa önce sor ("ekleme demedim mi").
- Cevaplar Türkçe, kısa, adım adım. Değişiklikten sonra ne değiştiğini maddelerle söyle.
- Her değişikliği test et (headless Chrome + sahte API ile), sonra commit et; **push'u Yasin "yayınla" deyince yap** (Netlify her yayında 15 kredi yer). Netlify (ve Vercel) main'den otomatik yayınlar (~1 dk).

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
- `api/notes.js` "Notlar & slaytlar": sadece link paylaşımı (`notes:list`), paylaşanın takma adı görünür; silme/geri al/yasak kütüphaneyle aynı mantık ve **aynı yasak listesi** (`lib:banned`).
- `api/admin.js` yönetici sayfası: kullanıcı listesi (kod + takma ad; `users` hash, `indexUser()` her PUT'ta günceller, eski hesaplar SCAN ile doldurulur), iletişim bilgisi (`admin:contact`, giriş ekranındaki “Kodumu unuttum” gösterir).
- `api/auth.js` giriş: kayıt (takma ad + e-posta + şifre, scrypt), giriş (takma ad ya da e-posta + şifre), eski koda şifre ekleme (`setpw`), Google (`GOOGLE_CLIENT_ID`, tokeninfo ile doğrulama, `google`/`linkgoogle`). Anahtarlar: `auth:user:KOD`, `auth:email:E`, `auth:byname:AD`, `auth:google:SUB`. Başarılı girişte istemciye hesabın kodu döner (kod = oturum). Admin `resetpw`. E-posta onayı: env `BREVO_API_KEY` + `MAIL_FROM` (isteğe bağlı `MAIL_NAME`) varsa kayıt ve her şifre ekleme/değiştirme 6 haneli kodla onaylanır (`auth:pending:E`, `auth:pendset:KOD`, 15 dk, 5 deneme; `verify`/`verifyset`/`resend`); yoksa onaysız çalışır. İstemcide `askVcode()`.
- Ortam değişkenleri (Netlify ve Vercel'de aynı): `KV_REST_API_URL`, `KV_REST_API_TOKEN` (Upstash), isteğe bağlı `ADMIN_CODE` (**virgülle birden fazla yönetici kodu**: `AB12,CD34`), isteğe bağlı `GOOGLE_CLIENT_ID` (yoksa Google butonu gizlenir).

## Uygulama mantığı (src içinde)
- Veri: `root = {folders:[kurul...], activeId, settings, kurulSort, kurulOrder}`; her kurul `{name, startDate, examDate, dailyHours, perLec, courses, topics, sessions, attend, absLimit, absMode, grade, archived, fromLib, manual, isDefault}`.
- Plan: `simulate()` — konu işlendiği günden önce plana girmez, aynı gün/dün işlenen öne alınır, günlük 2 saatlik parçalar, dersler karışık.
- Süre: `topicHours` = konunun ders saati × `perLec` × zorluk (0.75/1/1.4) veya elle girilen `hours`.
- Görünümler: home · add (Kurul ekle) · settings · faq · kurul (sekmeler: today/topics/program). Menü: `#drawer`.
- Kurul kodu: `encodeFolder/decodeFolder` (deflate-raw + base64url, `KRL1.`). Eşleştirme `matchFolder` kurul **numarasına** göre.
- Ayarlar `root.settings`: verdict, count, prio, quote, attend, theme (varsayılan koyu).

## Önizleme (kredisiz)
- Değişiklikleri önce `git push origin main:onizleme` ile **onizleme** dalına at → Vercel önizlemesi: https://sinav-asistani-git-onizleme-webteam7.vercel.app (VPN gerekir, aynı veritabanı). Netlify'a gitmez (0 kredi).
- Yasin "yayınla" deyince `git push origin main` → Netlify (15 kredi).

## Ek özellikler
- Takma ad: `root.profile.name` (kayıtta seçilir, ana sayfada ✏️). Kayıtta dil de seçilir.
- Rozetler: `BADGES`, `root.badges={id:tarih}`; Bugünün özeti `renderTodaySum()`. Rozet tablosu `api/board.js` (hash `board`, takma ad + rozet sayısı), `syncBoard()`.
- Giriş ekranı: Kayıt ol (takma ad + e-posta + şifre) / Giriş yap (takma ad|e-posta + şifre, “Eski kodumla gir”) / Google; ana sayfada “Hesap değiştir”. Admin uyarısı: `warn:KOD`, ad serbest + `names:blocked`.
- Hesap silme: `deleteAccount/restoreAccount` (_lib): `deleted:KOD` 10 dk; kullanıcı Ayarlar → Hesap (DELETE /api/data), admin `POST /api/admin {action:"delete"|"restore"}`. Onay + 10 sn geri al.
- v1.1: Canlı geri sayım + balon takvim `renderCountdown()` (sınav 09:00 kabul, `.count` ile gizlenir) · Odak sayacı `FOCUS` (localStorage `sa-focus`, 25/5 dk, bitince `creditFocus()` ilerlemeye ekler, sol altta hap) · Sınav analizi `openAnalysis()` (`state.result={cid:{n,d}}`) · Menü grupları `.nav-group` · Kurul ekle önizlemesi `loadAddPreview()`.
- Güne özel saat: `state.dayHours={"YYYY-MM-DD":saat}`, `hoursOn(i)`, `hoursCtl(i)` (Bugün kartı + Program'daki günler).
- Tekrar günü: `state.reviewDay` 0–7, `revDays(days)`.
- Takma ad zorunlu ve **benzersiz** (`api/name.js`: `names` hash küçük harfli ad → sahip; `claimName()`). Yoksa ya da başkasınınsa açılışta kapatılamaz pencere. Ana ekrana ekle rehberi `maybeA2HS()` bir kez (`root.settings.a2hs`). SSS'de 3. eleman true = ⭐.
- Haftalık istatistik: `root.studyLog = {"YYYY-MM-DD": saat}`; `logStudy(t, Δ%)` ilerleme değişince yazar (✓ çalıştım, geri al, Hiç/Az/…). Ana sayfa `renderStats()`.
- Takvime ekle: `downloadIcs(state)` (Program sekmesi → 📅 Takvime ekle) → .ics (dersler + sınav günü, 1 gün önce hatırlatma).
- PWA: `manifest.webmanifest`, `sw.js` (önce internet, yoksa önbellek; /api hariç), `icon-*.png`. Netlify build bunları `dist/`e kopyalar (netlify.toml). Ayarlar → Uygulama.

## Dil (TR / EN)
- Sağ üstte ⚙️ yanında TR|EN butonu + Ayarlar → Dil. `root.settings.lang` (+ localStorage `sa-lang`).
- Çeviri DOM üzerinden: `EN` sözlüğü (src'de, `const $` altında). Anahtar = ekrandaki Türkçe metin; `{#}` sayı, `{*}` herhangi metin. MutationObserver yeni metinleri çevirir; kullanıcı verisi (ders/konu adları) değişmez.
- **Yeni Türkçe metin eklediğinde EN sözlüğüne İngilizcesini de ekle.** Tarihler `LOC()` ile.

## Sürüm notları (Update Log)
- `UPDATE_LOG` (src içinde) — yeni sürüm EN ÜSTE eklenir; v1.0.0'dan başladı. **Bir sürümde en fazla 3 madde**, 4. madde yeni yama sürümü (v1.0.1…) açar. Dil resmi.
- Her yeni özelliğe `NEW_IN[key]=sürüm` + `newRib(key)` ile "YENİ" şeridi: sürümden sonra 7 gün görünür, kullanıcı o şeye basınca kaybolur (`root.settings.seenNew`).
- Görmediği sürümü kullanıcı açılışta bir kez görür (`root.settings.seenVer`). Menü "Sürüm notları" + footer'daki sürüm numarası açar.
- Silme / sıfırlama işlemleri `askConfirm` ile onay ister.
- **Netlify bedava plan: her yayın (push to main) 15 kredi, ayda 300.** Değişiklikleri biriktir, Yasin "yayınla" deyince push et.

## Test
Sahte API: basit bir Python HTTP sunucusu `/api/new`, `/api/data`, `/api/library` taklit eder; Playwright ile `index.html` açılır. Sayfa hatası (`pageerror`) olmamalı.
