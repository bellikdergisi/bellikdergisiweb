const mongoose = require('mongoose');

const blogSchema = new mongoose.Schema({
    baslik: { type: String, required: true },
    kategori: { type: String, required: true },
    ozet: { type: String, required: true },
    icerik: { type: String, required: true },
    kapakGorseli: { type: String, required: true },
    okunmaSayisi: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Blog', blogSchema);
