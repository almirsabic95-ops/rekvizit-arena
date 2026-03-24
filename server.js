const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Povezivanje na MongoDB
mongoose.connect('mongodb://localhost:27017/rekvizit_arena')
    .then(() => console.log('Baza Rekvizit Arena spremna.'))
    .catch(err => console.error('Greška baze:', err));

// Model korisnika
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    secretKey: { type: String, required: true },
    isFirstLogin: { type: Boolean, default: true },
    coins: { type: Number, default: 0 } // Priprema za Buy Me a Coffee sustav [cite: 2026-02-20]
});

const User = mongoose.model('User', UserSchema);

// Ruta za login/registraciju
app.post('/api/login', async (req, res) => {
    const { username, password, secretKey } = req.body;
    try {
        let user = await User.findOne({ username });

        if (!user) {
            // Prva prijava - registracija
            if (!secretKey) return res.status(400).json({ firstLogin: true });
            user = new User({ username, password, secretKey, isFirstLogin: false });
            await user.save();
            return res.json({ success: true, message: "Profil kreiran!" });
        } else {
            // Provjera lozinke
            if (user.password === password) {
                return res.json({ success: true, firstLogin: false });
            } else {
                return res.status(401).json({ success: false, message: "Pogrešna lozinka!" });
            }
        }
    } catch (err) {
        res.status(500).json({ error: "Serverska greška" });
    }
});

// Ruta za zaboravljenu lozinku
app.post('/api/reset-password', async (req, res) => {
    const { username, secretKey, newPassword } = req.body;
    const user = await User.findOne({ username, secretKey });
    if (user) {
        user.password = newPassword;
        await user.save();
        res.json({ success: true, message: "Lozinka promijenjena!" });
    } else {
        res.status(401).json({ success: false, message: "Nadimak ili tajna šifra netočni!" });
    }
});

server.listen(3000, () => console.log('Arena radi na portu 3000'));