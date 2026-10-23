# OpenChamber Argo CD Observer

[English](../README.md) | [简体中文](README.zh-CN.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [עברית](README.he.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (Brasil)](README.pt-BR.md) | Türkçe | [Українська](README.uk.md) | [繁體中文](README.zh-TW.md)

**OpenChamber için salt okunur bir Argo CD eklentisi**. Çalışma alanınızdan ayrılmadan uygulamalara göz atın, dağıtımları inceleyin, kaynak günlüklerini ve olaylarını okuyun.

## Kurulum

1. OpenChamber'da **Ayarlar → Eklentiler** bölümünü açın.
2. Bu depo URL'sini **Klasör, ZIP veya URL** alanına yapıştırıp **Ekle**'ye tıklayın:

   ```text
   https://github.com/hlhr202/OpenChamber-ArgoCD
   ```

3. İstenen Service yeteneğini inceleyip **İzin ver ve etkinleştir**'i seçin.
4. Eklenti çubuğundan **Argo CD**'yi açın ve bağlamlarınızı yükleyin.

Yerel derleme veya bağımlılık kurulumu gerekmez.

Alternatif olarak [Releases](https://github.com/hlhr202/OpenChamber-ArgoCD/releases/latest) sayfasından **openchamber-argocd.zip** dosyasını indirip Eklentiler bölümünden ekleyebilirsiniz. GitHub'ın **Source code (zip)** arşivini değil, ekli hazır ZIP paketini kullanın.

## Ön koşullar

- [v1.24.0](https://github.com/openchamber/openchamber/releases/tag/v1.24.0) ile sunulan **eklenti desteğine sahip OpenChamber**. Bu derleme şu anda kurulum için **v2.2.0 veya üstünü** gerektirir; eski sürümlerle uyumluluk doğrulanmamıştır.
- OpenChamber Server'ı çalıştıran işletim sistemi kullanıcısı için **Argo CD CLI kurulu ve yapılandırılmış** olmalıdır; geçerli kimlik bilgileri ve gerekli uygulama, kaynak, günlük ve olayları okuma izinleri gerekir. Eklenti mevcut yapılandırmayı okur; CLI'yi çalıştırmaz ve ayrıca oturum açmaz.
- OpenChamber Server, yapılandırılmış Argo CD API'sine erişebilmelidir.

## Ekran görüntüleri

Örnek verilerle İngilizce arayüz.

**Masaüstü — uygulama listesi ve genel bakış**

![Masaüstünde Argo CD uygulama listesi ve genel bakış](applications-desktop.png)

**Mobil — uygulama listesi**

![Mobilde Argo CD uygulama listesi](applications-mobile.png)

## Özellikler

- Argo CD bağlamlarını değiştirin, uygulamaları arayın veya filtreleyin.
- Uygulama yapılandırmasını, durumunu, dağıtım geçmişini ve kaynak ağaçlarını inceleyin.
- Pod/konteyner günlüklerini, olayları, manifestleri ve farkları okuyun.
- Sorun giderme özetlerini önizleyin ve sohbete eklemeden önce onaylayın.
- Tasarım gereği salt okunurdur; OpenChamber'ın dilini ve temasını izler.

## Gizlilik

- Bu eklenti kişisel bilgi toplamaz veya geliştiricilerine özel veri bildirmez. Telemetri, analiz veya izleme içermez.
- Mevcut yerel kimlik bilgileri yalnızca yapılandırılmış Argo CD API'nize gönderilen isteklerin kimliğini doğrulamak için okunur. Kimlik bilgileri, uygulama verileri, günlükler ve olaylar geliştiricilerin veya üçüncü tarafların veri toplama hizmetlerine yüklenmez.
- Gezinme tercihleri (dizin, bağlam, uygulama/kaynak kimlikleri, uygulama filtreleri, sekmeler ve düzen) OpenChamber depolamasına kaydedilir: destekleniyorsa bu cihaza, aksi halde bağlı Server'a. Kimlik bilgileri, sorgu sonuçları, günlük/olay içerikleri ve özet önizlemeleri buraya kaydedilmez. Seçimler geri yüklendiğinde veriler yeniden sorgulanır; günlük takibi hiçbir zaman otomatik sürdürülmez.
- Sohbete özet eklemek açık önizlemenizi ve onayınızı gerektirir. Daha sonra gönderirseniz OpenChamber ve seçtiğiniz model sağlayıcısı içeriği kendi politikalarına göre işler.

Bu açıklama yalnızca bu eklentiyi kapsar; OpenChamber, Argo CD veya model sağlayıcılarının veri uygulamalarını kapsamaz.

## Lisans

[MIT](../LICENSE). Paketlenen bağımlılıklar ve Argo simgesi kendi lisanslarını korur; [üçüncü taraf bildirimlerine](../THIRD_PARTY_NOTICES.txt) bakın.
