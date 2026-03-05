const mongoose = require('mongoose');

// Kullanıcı kalıbımızı (şemamızı) oluşturuyoruz
const userSchema = new mongoose.Schema({
    adSoyad: { 
        type: String, 
        required: true // İsim girmek zorunlu
    },
    email: { 
        type: String, 
        required: true, 
        unique: true // Aynı e-postayla iki kere kayıt olunamaz
    },
    sifre: { 
        type: String, 
        required: true 
    },
    rol: { 
        type: String, 
        default: 'uye' // Varsayılan olarak herkes 'uye' olur. Seni daha sonra 'admin' yapacağız.
    }
}, { timestamps: true }); // Ne zaman kayıt olduğunu (tarih/saat) otomatik tutar

// Bu kalıbı diğer dosyalarda kullanabilmek için dışa aktarıyoruz
module.exports = mongoose.model('User', userSchema);