const mongoose = require('mongoose');

// Dergi Sayısı kalıbımızı oluşturuyoruz
const issueSchema = new mongoose.Schema({
    sayiNo: {
        type: String,
        required: true // Örn: "#01", "#02"
    },
    baslik: {
        type: String,
        required: true // Örn: "THY Sayısı"
    },
    aciklama: {
        type: String,
        required: true // Örn: "Ocak - Şubat 2024"
    },
    kapakGorseli: {
        type: String,
        required: true // Yüklenen resmin sunucudaki yolu
    },
    pdfDosyasi: {
        type: String,
        required: true // Yüklenen PDF'in sunucudaki yolu
    }
}, { timestamps: true });

module.exports = mongoose.model('Issue', issueSchema);