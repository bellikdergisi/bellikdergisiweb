// Gerekli paketleri projemize dahil ediyoruz
const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer'); 
const nodemailer = require('nodemailer'); // YENİ: E-posta Postacımız
require('dotenv').config();

// Kalıplarımızı çağırıyoruz
const User = require('./models/User');
const Application = require('./models/Application');
const Issue = require('./models/Issue');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// === MONGODB VERİTABANI BAĞLANTISI ===
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Harika! Veritabanına (MongoDB) başarıyla bağlanıldı!'))
    .catch((err) => console.log('❌ Veritabanı bağlantı hatası:', err.message));


// === MULTER (DOSYA YÜKLEME) AYARLARI ===
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads') 
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '-')); 
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

// 2. YAZAR BAŞVURUSU YAPMA
app.post('/api/basvuru', tokenKontrol, async (req, res) => {
    try {
        const { basvuruTuru, portfolyo } = req.body;
        const user = await User.findById(req.user.id);
        const beklemedeOlan = await Application.findOne({ kullaniciId: req.user.id, durum: 'Beklemede' });
        if (beklemedeOlan) return res.status(400).json({ mesaj: 'Zaten değerlendirmede olan bir başvurunuz var.' });
        
        const yeniBasvuru = new Application({ kullaniciId: req.user.id, adSoyad: user.adSoyad, basvuruTuru, portfolyo });
        await yeniBasvuru.save();

        // ADMİN MAİLİNE BİLDİRİM GÖNDERME
        const mailOptions = {
            from: `"Bellik Sistem" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER, // Senin belirlediğin adrese gider
            subject: `📢 Yeni Yazar Başvurusu: ${user.adSoyad}`,
            text: `Merhaba,\n\nSisteme yeni bir "${basvuruTuru}" başvurusu düştü.\n\nBaşvuran: ${user.adSoyad}\nE-Posta: ${user.email}\nPortfolyo/Kendinden Bahset: ${portfolyo}\n\nAdmin panelinden girip onaylayabilir veya reddedebilirsiniz.`
        };
        transporter.sendMail(mailOptions, (err, info) => {
            if(err) console.log('Admin bildirim maili hatası:', err);
        });

        res.status(201).json({ mesaj: 'Başvurunuz başarıyla alındı! Ekibimiz inceleyecektir.' });
    } catch (error) { res.status(500).json({ mesaj: 'Sunucu hatası.' }); }
});


// 3. ADMIN PANELİ İŞLEMLERİ
app.get('/api/admin/istatistikler', adminKontrol, async (req, res) => {
    try {
        const uyeSayisi = await User.countDocuments();
        const toplamBasvuru = await Application.countDocuments();
        const bekleyenBasvuru = await Application.countDocuments({ durum: 'Beklemede' });
        res.json({ uyeSayisi, toplamBasvuru, bekleyenBasvuru });
    } catch (error) { res.status(500).json({ mesaj: 'İstatistikler alınamadı.' }); }
});

app.get('/api/admin/basvurular', adminKontrol, async (req, res) => {
    try {
        const basvurular = await Application.find({ durum: 'Beklemede' }).sort({ createdAt: -1 });
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


// 4. DERGİ YÜKLEME VE LİSTELEME
app.post('/api/admin/dergi-yukle', adminKontrol, upload.fields([{ name: 'kapak', maxCount: 1 }, { name: 'pdf', maxCount: 1 }]), async (req, res) => {
    try {
        const { sayiNo, baslik, aciklama } = req.body;
        const kapakGorseli = '/uploads/' + req.files['kapak'][0].filename;
        const pdfDosyasi = '/uploads/' + req.files['pdf'][0].filename;

        const yeniDergi = new Issue({ sayiNo, baslik, aciklama, kapakGorseli, pdfDosyasi });
        await yeniDergi.save();

        // TÜM ÜYELERE YENİ DERGİ MAİLİ GÖNDERME
        const tumUyeler = await User.find({}, 'email'); // Sadece mailleri çek
        const mailListesi = tumUyeler.map(uye => uye.email);

        if (mailListesi.length > 0) {
            const mailOptions = {
                from: `"Bellik Dergisi" <${process.env.EMAIL_USER}>`,
                bcc: mailListesi, // Gizli kopya, kimse kimsenin mailini göremez
                subject: `🔥 Yeni Sayımız Yayında: ${baslik}!`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-w-md; margin: auto; padding: 20px; border: 1px solid #eee;">
                        <h2 style="color: #B11E1E; text-transform: uppercase;">Merhaba Bellik Okuru!</h2>
                        <p>Heyecanla beklenen <strong>${sayiNo} numaralı ${baslik}</strong> an itibariyle sitemizde yayına girdi.</p>
                        <p style="color: #555;"><i>${aciklama}</i></p>
                        <p>Hemen okumak veya PDF olarak indirmek için aşağıdaki butona tıklayarak sitemize gidebilirsin:</p>
                        <a href="http://localhost:3000" style="display: inline-block; background-color: #B11E1E; color: white; padding: 10px 20px; text-decoration: none; font-weight: bold; margin-top: 15px; text-transform: uppercase; font-size: 12px;">Hemen Oku</a>
                        <br><br>
                        <p style="font-size: 12px; color: #999;">Keyifli okumalar dileriz,<br>Bellik Dergisi Ekibi</p>
                    </div>
                `
            };
            transporter.sendMail(mailOptions, (err, info) => {
                if(err) console.log('Üyelere mail hatası:', err);
                else console.log('Tüm üyelere bildirim maili gönderildi!');
            });
        }

        res.status(201).json({ mesaj: 'Dergi başarıyla yüklendi ve tüm üyelere e-posta gönderildi! 🎉' });
    } catch (error) {
        console.error('Dergi yükleme hatası:', error);
        res.status(500).json({ mesaj: 'Dergi yüklenirken hata oluştu.' });
    }
});

app.get('/api/dergiler', async (req, res) => {
    try {
        const dergiler = await Issue.find().sort({ createdAt: -1 });
        res.json(dergiler);
    } catch (error) { res.status(500).json({ mesaj: 'Dergiler alınamadı.' }); }
});

// Sunucuyu dinlemeye başlıyoruz
app.listen(port, () => {
    console.log(`🚀 Bellik Dergisi sunucusu http://localhost:${port} adresinde çalışıyor!`);
});