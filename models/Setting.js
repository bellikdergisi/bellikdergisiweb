const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
    anahtar: { type: String, required: true, unique: true },
    deger: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Setting', settingSchema);
