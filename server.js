const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static(__dirname));

mongoose.connect('mongodb://localhost:27017/rekvizit_arena')
    .then(() => console.log('MongoDB povezan'))
    .catch(err => console.log('Baza nije pokrenuta:', err));

const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, unique: true },
    password: { type: String },
    secretKey: { type: String },
    coins: { type: Number, default: 0 } // Za Buy Me a Coffee sustav [cite: 2026-02-20]
}));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/login', async (req, res) => {
    const { username, password, secretKey } = req.body;
    const user = await User.findOne({ username });

    if (!user) {
        if (!secretKey) return res.status(400).json({ firstLogin: true, message: "Prva prijava" });
        const newUser = new User({ username, password, secretKey });
        await newUser.save();
        return res.json({ success: true, message: "Profil kreiran" });
    }

    if (user.password === password) {
        res.json({ success: true, message: "Uspješan login" });
    } else {
        res.status(401).json({ success: false, message: "Pogrešna lozinka" });
    }
});

app.post('/api/reset-password', async (req, res) => {
    const { username, secretKey, newPassword } = req.body;
    const user = await User.findOne({ username, secretKey });

    if (user) {
        user.password = newPassword;
        await user.save();
        res.json({ success: true, message: "Lozinka je uspješno promijenjena" });
    } else {
        res.status(401).json({ success: false, message: "Netočni podaci za reset" });
    }
});

server.listen(3000, () => console.log('Server trči na portu 3000'));