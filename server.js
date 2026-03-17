// Gerekli paketleri projemize dahil ediyoruz
const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
require('dotenv').config();

// Cloudinary Yapılandırması
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Kalıplarımızı çağırıyoruz
const User = require('./models/User');
const Application = require('./models/Application');
const Issue = require('./models/Issue');
const Blog = require('./models/Blog');
const Setting = require('./models/Setting');

const app = express();
const port = process.env.PORT || 3000;

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(mongoSanitize());
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { mesaj: "Çok fazla istek gönderdiniz, lütfen 15 dakika sonra tekrar deneyin." }
});

app.use('/api/register', limiter);
app.use('/api/login', limiter);
app.use('/api/admin/login', limiter);

// === MONGODB VERİTABANI BAĞLANTISI ===
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Harika! Veritabanına (MongoDB) başarıyla bağlanıldı!'))
    .catch((err) => console.log('❌ Veritabanı bağlantı hatası:', err.message));


// === MULTER (CLOUD DOSYA YÜKLEME) AYARLARI ===
const trMap = {
    'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u',
    'Ç': 'C', 'Ğ': 'G', 'İ': 'I', 'Ö': 'O', 'Ş': 'S', 'Ü': 'U'
};

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'bellik_uploads',
        allowed_formats: ['jpg', 'png', 'jpeg', 'webp', 'pdf'],
        resource_type: 'auto', // PDF ve rsimlerin karışık yönetilmesi için otomatik bırakıyoruz
        public_id: (req, file) => {
            let originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
            let safeName = originalName.replace(/[çğğıöşüÇĞİÖŞÜ]/g, match => trMap[match] || match)
                .replace(/[^a-zA-Z0-9.-]/g, '-')
                .replace(/\.+/g, '.')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '')
                .replace(/\.(pdf|jpeg|jpg|png|webp)$/i, ''); // Uzantıyı sil, cloudinary kendi eklesin

            return Date.now() + '-' + safeName;
        }
    }
});
const upload = multer({ storage: storage });

// === NODEMAILER (E-POSTA) AYARLARI ===
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// === GÜVENLİK KONTROLLERİ (MIDDLEWARE) ===
const tokenKontrol = (req, res, next) => {
    const token = req.header('Authorization');
    if (!token) return res.status(401).json({ mesaj: 'Lütfen önce giriş yapın.' });
    try {
        const verified = jwt.verify(token.replace('Bearer ', ''), process.env.JWT_SECRET);
        req.user = verified;
        next();
    } catch (error) {
        res.status(400).json({ mesaj: 'Geçersiz veya süresi dolmuş oturum.' });
    }
};

const adminKontrol = (req, res, next) => {
    tokenKontrol(req, res, () => {
        if (req.user.rol !== 'admin') return res.status(403).json({ mesaj: 'Hooop! Buraya sadece Bellik Dergisi yöneticisi girebilir 😎' });
        next();
    });
};


// === API YÖNLENDİRMELERİ (ROUTES) ===

// YENİ: Ayrı sekmede açılacak Admin Paneli Rotası
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 1. ÜYELİK İŞLEMLERİ
app.post('/api/register', async (req, res) => {
    try {
        const { adSoyad, email, sifre } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ mesaj: 'Bu e-posta zaten kullanılıyor.' });
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(sifre, salt);
        const newUser = new User({ adSoyad, email, sifre: hashedPassword });
        await newUser.save();
        res.status(201).json({ mesaj: 'Kayıt başarılı!' });
    } catch (error) { res.status(500).json({ mesaj: 'Sunucu hatası.' }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, sifre } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ mesaj: 'Hesap bulunamadı.' });
        const isMatch = await bcrypt.compare(sifre, user.sifre);
        if (!isMatch) return res.status(400).json({ mesaj: 'Hatalı şifre.' });
        const token = jwt.sign({ id: user._id, rol: user.rol }, process.env.JWT_SECRET, { expiresIn: '1d' });
        res.json({ mesaj: 'Giriş başarılı!', token: token, kullanici: { adSoyad: user.adSoyad, email: user.email, rol: user.rol } });
    } catch (error) { res.status(500).json({ mesaj: 'Sunucu hatası.' }); }
});

// KULLANICI PROFİL İŞLEMLERİ
app.get('/api/kullanici/profil', tokenKontrol, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-sifre').populate('okunanDergiler');
        res.json(user);
    } catch (error) { res.status(500).json({ mesaj: 'Profil alınamadı.' }); }
});

app.put('/api/kullanici/profil', tokenKontrol, async (req, res) => {
    try {
        const { hakkimda } = req.body;
        await User.findByIdAndUpdate(req.user.id, { hakkimda });
        res.json({ mesaj: 'Profil başarıyla güncellendi!' });
    } catch (error) { res.status(500).json({ mesaj: 'Profil güncellenemedi.' }); }
});

app.post('/api/kullanici/okudum/:id', tokenKontrol, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user.okunanDergiler.includes(req.params.id)) {
            user.okunanDergiler.push(req.params.id);
            await user.save();
        }
        res.json({ mesaj: 'Okuma listesine eklendi.' });
    } catch (error) { res.status(500).json({ mesaj: 'Hata oluştu.' }); }
});

// 2. YAZAR BAŞVURUSU YAPMA
app.post('/api/basvuru', tokenKontrol, async (req, res) => {
    try {
        const { basvuruTuru, portfolyo } = req.body;
        const user = await User.findById(req.user.id);
        const beklemedeOlan = await Application.findOne({ kullaniciId: req.user.id, durum: 'Beklemede' });
        if (beklemedeOlan) return res.status(400).json({ mesaj: 'Zaten değerlendirmede olan bir başvurunuz var.' });

        const yeniBasvuru = new Application({ kullaniciId: req.user.id, adSoyad: user.adSoyad, basvuruTuru, portfolyo });
        await yeniBasvuru.save();

        const mailOptions = {
            from: `"Bellik Sistem" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER,
            subject: `📢 Yeni Yazar Başvurusu: ${user.adSoyad}`,
            text: `Merhaba,\n\nSisteme yeni bir "${basvuruTuru}" başvurusu düştü.\n\nBaşvuran: ${user.adSoyad}\nE-Posta: ${user.email}\nPortfolyo/Kendinden Bahset: ${portfolyo}\n\nAdmin panelinden girip onaylayabilir veya reddedebilirsiniz.`
        };
        transporter.sendMail(mailOptions, (err, info) => {
            if (err) console.log('Admin bildirim maili hatası:', err);
        });

        res.status(201).json({ mesaj: 'Başvurunuz başarıyla alındı! Ekibimiz inceleyecektir.' });
    } catch (error) { res.status(500).json({ mesaj: 'Sunucu hatası.' }); }
});

// 3. ADMIN PANELİ İŞLEMLERİ

app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    if (username === 'bellikberat25' && password === 'Bellik.Berat.2552') {
        const token = jwt.sign({ rol: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1d' });
        res.json({ mesaj: 'Admin girişi başarılı!', token: token });
    } else {
        res.status(400).json({ mesaj: 'Hatalı kullanıcı adı veya şifre!' });
    }
});

app.get('/api/admin/istatistikler', adminKontrol, async (req, res) => {
    try {
        const uyeSayisi = await User.countDocuments();
        const toplamBasvuru = await Application.countDocuments();
        const bekleyenBasvuru = await Application.countDocuments({ durum: 'Beklemede' });
        res.json({ uyeSayisi, toplamBasvuru, bekleyenBasvuru });
    } catch (error) { res.status(500).json({ mesaj: 'İstatistikler alınamadı.' }); }
});

// YENİ: Kayıtlı Üyeleri Detaylı Çekme
app.get('/api/admin/uyeler', adminKontrol, async (req, res) => {
    try {
        const uyeler = await User.find().select('-sifre').sort({ createdAt: -1 });
        res.json(uyeler);
    } catch (error) { res.status(500).json({ mesaj: 'Üyeler alınamadı.' }); }
});

// GÜNCELLENDİ: Başvuruları Çekme (Tüm başvuruları veya sadece bekleyenleri)
app.get('/api/admin/basvurular', adminKontrol, async (req, res) => {
    try {
        const basvurular = await Application.find().sort({ createdAt: -1 }); // Tüm başvuruları listeler
        res.json(basvurular);
    } catch (error) { res.status(500).json({ mesaj: 'Başvurular alınamadı.' }); }
});

app.put('/api/admin/basvuru/:id', adminKontrol, async (req, res) => {
    try {
        const { durum } = req.body;
        await Application.findByIdAndUpdate(req.params.id, { durum: durum });
        res.json({ mesaj: `Başvuru ${durum.toLowerCase()}!` });
    } catch (error) { res.status(500).json({ mesaj: 'Başvuru güncellenemedi.' }); }
});

// YENİ: Dergi Silme İşlemi
app.delete('/api/admin/dergi/:id', adminKontrol, async (req, res) => {
    try {
        await Issue.findByIdAndDelete(req.params.id);
        res.json({ mesaj: 'Dergi sistemden başarıyla silindi!' });
    } catch (error) { res.status(500).json({ mesaj: 'Dergi silinirken hata oluştu.' }); }
});

// 4. DERGİ YÜKLEME VE LİSTELEME
app.post('/api/admin/dergi-yukle', adminKontrol, upload.fields([{ name: 'kapak', maxCount: 1 }, { name: 'pdf', maxCount: 1 }]), async (req, res) => {
    try {
        const { sayiNo, baslik, aciklama } = req.body;
        // cloudinary path olarak saklıyor linki
        const kapakGorseli = req.files['kapak'][0].path;
        const pdfDosyasi = req.files['pdf'][0].path;

        const yeniDergi = new Issue({ sayiNo, baslik, aciklama, kapakGorseli, pdfDosyasi });
        await yeniDergi.save();

        const tumUyeler = await User.find({}, 'email');
        const mailListesi = tumUyeler.map(uye => uye.email);

        if (mailListesi.length > 0) {
            const batchSize = 50;
            for (let i = 0; i < mailListesi.length; i += batchSize) {
                const batchEmails = mailListesi.slice(i, i + batchSize);
                const mailOptions = {
                    from: `"Bellik Dergisi" <${process.env.EMAIL_USER}>`,
                    bcc: batchEmails.join(','),
                    subject: `🔥 Yeni Sayımız Yayında: ${baslik}!`,
                    html: `
                        <div style="font-family: Arial, sans-serif; max-w-md; margin: auto; padding: 20px; border: 1px solid #eee;">
                            <h2 style="color: #B11E1E; text-transform: uppercase;">Merhaba Bellik Okuru!</h2>
                            <p>Heyecanla beklenen <strong>${sayiNo} numaralı ${baslik}</strong> an itibariyle sitemizde yayına girdi.</p>
                            <p style="color: #555;"><i>${aciklama}</i></p>
                            <p>Hemen okumak için aşağıdaki butona tıklayarak sitemize gidebilirsin:</p>
                            <a href="https://www.bellikdergisi.com" style="display: inline-block; background-color: #B11E1E; color: white; padding: 10px 20px; text-decoration: none; font-weight: bold; margin-top: 15px; text-transform: uppercase; font-size: 12px;">Hemen Oku</a>
                            <br><br>
                            <p style="font-size: 12px; color: #999;">Keyifli okumalar dileriz,<br>Bellik Dergisi Ekibi</p>
                        </div>
                    `
                };
                
                // await ile gönderiyoruz ki spama düşmesin çok hızlı gidip patlamasın.
                try {
                    await transporter.sendMail(mailOptions);
                } catch (mailErr) {
                    console.log('Toplu mail hatası:', mailErr);
                }
            }
        }
        res.status(201).json({ mesaj: 'Dergi başarıyla yüklendi ve üyelere e-posta gönderildi! 🎉' });
    } catch (error) { res.status(500).json({ mesaj: 'Dergi yüklenirken hata oluştu.' }); }
});

app.get('/api/dergiler', async (req, res) => {
    try {
        const dergiler = await Issue.find().sort({ createdAt: -1 });
        res.json(dergiler);
    } catch (error) { res.status(500).json({ mesaj: 'Dergiler alınamadı.' }); }
});

// YENİ: Dergi Okunma/Görüntülenme Sayısını Arttırma
app.post('/api/dergi/:id/okunma', async (req, res) => {
    try {
        await Issue.findByIdAndUpdate(req.params.id, { $inc: { goruntulenme: 1 } });
        res.json({ mesaj: 'Okunma arttırıldı' });
    } catch (error) { res.status(500).json({ mesaj: 'Hata' }); }
});

// === SITE AYARLARI KISMI ===
app.get('/api/settings', async (req, res) => {
    try {
        const ayarlar = await Setting.find();
        res.json(ayarlar);
    } catch (error) { res.status(500).json({ mesaj: 'Ayarlar alınamadı.' }); }
});

app.put('/api/admin/settings', adminKontrol, async (req, res) => {
    try {
        const { ayarlar } = req.body; // Gelen settings array formati: [{ anahtar, deger }]
        for (let ayar of ayarlar) {
            await Setting.findOneAndUpdate({ anahtar: ayar.anahtar }, { deger: ayar.deger }, { upsert: true });
        }
        res.json({ mesaj: 'Ayarlar güncellendi' });
    } catch (error) { res.status(500).json({ mesaj: 'Ayarlar güncellenirken hata oluştu' }); }
});

// === BLOG KISMI ===
app.get('/api/blogs', async (req, res) => {
    try {
        const bloglar = await Blog.find().sort({ createdAt: -1 });
        res.json(bloglar);
    } catch (error) { res.status(500).json({ mesaj: 'Bloglar alınamadı.' }); }
});

app.get('/api/blog/:id', async (req, res) => {
    try {
        const blog = await Blog.findByIdAndUpdate(req.params.id, { $inc: { okunmaSayisi: 1 } }, { new: true });
        res.json(blog);
    } catch (error) { res.status(500).json({ mesaj: 'Blog alınamadı' }); }
});

app.post('/api/admin/blog', adminKontrol, upload.single('kapak'), async (req, res) => {
    try {
        const { baslik, kategori, ozet, icerik } = req.body;
        const kapakGorseli = req.file ? req.file.path : '';
        const yeniBlog = new Blog({ baslik, kategori, ozet, icerik, kapakGorseli });
        await yeniBlog.save();
        res.json({ mesaj: 'Blog eklendi' });
    } catch (error) { res.status(500).json({ mesaj: 'Hata' }); }
});

app.delete('/api/admin/blog/:id', adminKontrol, async (req, res) => {
    try {
        await Blog.findByIdAndDelete(req.params.id);
        res.json({ mesaj: 'Blog silindi' });
    } catch (error) { res.status(500).json({ mesaj: 'Hata' }); }
});

// Sunucuyu dinlemeye başlıyoruz
app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Bellik Dergisi sunucusu http://localhost:${port} ve ağınızda çalışıyor!`);
});