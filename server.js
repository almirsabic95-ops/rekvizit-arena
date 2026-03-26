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

// --- BAZA PODATAKA ---
const dbURI = "mongodb+srv://rekvizit:arenakviz@rekvizit.o6ugw5r.mongodb.net/RekvizitArena?retryWrites=true&w=majority&appName=Rekvizit";

mongoose.connect(dbURI)
    .then(() => console.log('✅ Arena povezana na MongoDB'))
    .catch(err => console.log('❌ Greška baze:', err));

// --- MODEL KORISNIKA (Sa svim tvojim parametrima) ---
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    secretKey: { type: String, required: true },
    coins: { type: Number, default: 0 },
    level: { type: Number, default: 0 },
    loginStreak: { type: Number, default: 1 },
    lastLogin: { type: Date, default: Date.now },
    stats: { 
        vjesala: {
            level: { type: Number, default: 0 },
            solved: { type: Number, default: 0 }
        }
    }
});
const User = mongoose.model('User', UserSchema);

// --- MODULI IGARA ---
const vjesala = require('./kvizovi/vjesala');
vjesala.inicijalizirajVjesala(io);

// --- RUTE ZA STRANICE ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/kvizovi/vjesala', (req, res) => res.sendFile(path.join(__dirname, 'kvizovi', 'vjesala.html')));

// --- API: LJESTVICA (LEADERBOARD) ---
app.get('/api/leaderboard', async (req, res) => {
    try {
        const topUsers = await User.find({ "stats.vjesala": { $exists: true } })
            .sort({ "stats.vjesala.level": -1, "stats.vjesala.solved": -1 })
            .limit(10);
            
        res.json(topUsers.map(u => ({
            name: u.username,
            lvl: u.stats.vjesala.level || 0,
            solved: u.stats.vjesala.solved || 0
        })));
    } catch (e) {
        res.status(500).json([]);
    }
});

// --- API: LOGIN + STREAK + COINS LOGIKA ---
app.post('/api/login', async (req, res) => {
    const { username, password, secretKey } = req.body;
    try {
        let user = await User.findOne({ username });

        // Registracija novog korisnika
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

        // Provjera lozinke i Streak logika
        if (user.password === password) {
            const sada = new Date();
            const danasPocetak = new Date(sada.getFullYear(), sada.getMonth(), sada.getDate()).getTime();
            const zadnjaPrijava = new Date(user.lastLogin);
            const zadnjiPocetak = new Date(zadnjaPrijava.getFullYear(), zadnjaPrijava.getMonth(), zadnjaPrijava.getDate()).getTime();

            // Ako je prošao barem jedan dan od zadnje prijave
            if (danasPocetak > zadnjiPocetak) {
                const daniRazlike = (danasPocetak - zadnjiPocetak) / (1000 * 60 * 60 * 24);
                
                if (daniRazlike === 1) {
                    // Prijavio se dan za danom - povećaj streak (do max 7)
                    user.loginStreak = (user.loginStreak >= 7) ? 1 : user.loginStreak + 1;
                } else {
                    // Preskočio je dan - resetiraj na 1
                    user.loginStreak = 1; 
                }
                
                // Nagrada u novčićima bazirana na streaku
                user.coins = (user.coins || 0) + (user.loginStreak * 10);
                user.lastLogin = sada;
                await user.save();
            }

            res.json({ 
                success: true, 
                username: user.username,
                coins: user.coins,
                streak: user.loginStreak || 1,
                level: user.level,
                vStats: user.stats.vjesala
            });
        } else {
            res.status(401).json({ success: false, message: "Pogrešna lozinka!" });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: "Greška na serveru" });
    }
});

// --- SOCKET.IO (CHAT I STATUS) ---
io.on('connection', (socket) => {
    socket.on('login-success', (u) => {
        socket.username = u;
        console.log(`👤 Prijavljen: ${u}`);
    });

    socket.on('send-msg', (text) => {
        if (socket.username) {
            io.emit('receive-msg', { user: socket.username, text: text });
        }
    });

    socket.on('disconnect', () => {
        if (socket.username) console.log(`👋 Otišao: ${socket.username}`);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Rekvizit Arena na portu ${PORT}`));