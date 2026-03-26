const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(__dirname));

const dbURI = "mongodb+srv://rekvizit:arenakviz@rekvizit.o6ugw5r.mongodb.net/RekvizitArena?retryWrites=true&w=majority&appName=Rekvizit";

mongoose.connect(dbURI)
    .then(() => console.log('✅ Arena povezana'))
    .catch(err => console.log('❌ Greška baze:', err));

// --- MODEL KORISNIKA (Svi tvoji parametri) ---
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    secretKey: { type: String, required: true },
    coins: { type: Number, default: 0 },
    level: { type: Number, default: 0 },
    loginStreak: { type: Number, default: 1 },
    lastLogin: { type: Date, default: Date.now },
    stats: { 
        type: Object, 
        default: { vjesala: { level: 0, solved: 0 } } 
    }
});
const User = mongoose.model('User', UserSchema);

// --- UCITAVANJE KVIZOVA ---
const vjesala = require('./kvizovi/vjesala');
vjesala.inicijalizirajVjesala(io);

// --- RUTE ---

// 1. Putanja za vjesala.html
app.get('/kvizovi/vjesala', (req, res) => {
    res.sendFile(path.join(__dirname, 'kvizovi', 'vjesala.html'));
});

// 2. Ruta za Leaderboard (Ljestvica)
app.get('/api/leaderboard', async (req, res) => {
    try {
        const topUsers = await User.find({ "stats.vjesala": { $exists: true } })
            .sort({ "stats.vjesala.level": -1, "stats.vjesala.solved": -1 })
            .limit(5);
        res.json(topUsers.map(u => ({
            name: u.username,
            lvl: u.stats.vjesala.level || 0,
            solved: u.stats.vjesala.solved || 0
        })));
    } catch (e) {
        res.status(500).json([]);
    }
});

// 3. Login sustav sa Streak logikom
app.post('/api/login', async (req, res) => {
    const { username, password, secretKey } = req.body;
    try {
        let user = await User.findOne({ username });
        
        // Ako korisnik ne postoji, pokušaj registraciju
        if (!user) {
            if (!secretKey) return res.status(400).json({ firstLogin: true });
            user = new User({ 
                username, 
                password, 
                secretKey,
                stats: { vjesala: { level: 0, solved: 0 } }
            });
            await user.save();
        }

        // Provjera lozinke
        if (user.password === password) {
            const sada = new Date();
            const danasPocetak = new Date(sada.getFullYear(), sada.getMonth(), sada.getDate()).getTime();
            const zadnjaPrijava = new Date(user.lastLogin);
            const zadnjiPocetak = new Date(zadnjaPrijava.getFullYear(), zadnjaPrijava.getMonth(), zadnjaPrijava.getDate()).getTime();

            // Streak i Coins logika
            if (danasPocetak > zadnjiPocetak) {
                const daniRazlike = (danasPocetak - zadnjiPocetak) / (1000 * 60 * 60 * 24);
                if (daniRazlike === 1) {
                    user.loginStreak = (user.loginStreak >= 7) ? 1 : user.loginStreak + 1;
                } else {
                    user.loginStreak = 1; 
                }
                user.coins = (user.coins || 0) + (user.loginStreak * 10);
                user.lastLogin = sada;
                await user.save();
            }

            res.json({ 
                success: true, 
                username: user.username,
                coins: user.coins,
                level: user.level,
                streak: user.loginStreak || 1,
                vStats: user.stats.vjesala || { level: 0, solved: 0 }
            });
        } else {
            res.status(401).json({ success: false, message: "Netočna lozinka!" });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// --- SOCKET.IO KOMUNIKACIJA ---
io.on('connection', (socket) => {
    socket.on('login-success', (username) => {
        socket.username = username;
        console.log(`👤 Korisnik povezan: ${username}`);
    });

    socket.on('send-msg', (text) => {
        if (socket.username) {
            io.emit('receive-msg', { user: socket.username, text });
        }
    });

    socket.on('disconnect', () => {
        if (socket.username) console.log(`👋 ${socket.username} je izašao.`);
    });
});

// Port postavljen za Render (10000) ili lokalno (3000)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Arena aktivna na portu ${PORT}`));