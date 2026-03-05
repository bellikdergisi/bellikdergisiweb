const mongoose = require('mongoose');

// Başvuru kalıbımızı oluşturuyoruz
const applicationSchema = new mongoose.Schema({
    kullaniciId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', // Hangi üyenin başvurduğunu User modeliyle eşleştiriyoruz
        required: true
    },
    adSoyad: {
        type: String,
        required: true
    },
    basvuruTuru: {
        type: String,
        required: true // "Blog Yazarı" veya "Dergi Yazarı" gelecek
    },
    portfolyo: {
        type: String,
        required: true // Kişinin kendinden bahsettiği yazı veya link
    },
    durum: {
        type: String,
        default: 'Beklemede' // Sen admin panelinden Onaylandı veya Reddedildi yapana kadar Beklemede kalacak
    }
}, { timestamps: true });

module.exports = mongoose.model('Application', applicationSchema);