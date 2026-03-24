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

// MONGO DB ATLAS KONEKCIJA
const dbURI = "mongodb+srv://rekvizit:arenakviz@rekvizit.o6ugw5r.mongodb.net/RekvizitArena?retryWrites=true&w=majority&appName=Rekvizit";

mongoose.connect(dbURI)
    .then(() => console.log('✅ Arena povezana na MongoDB Atlas'))
    .catch(err => console.log('❌ Greška baze:', err));

// MODEL KORISNIKA
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    secretKey: { type: String, required: true },
    coins: { type: Number, default: 0 },
    loginStreak: { type: Number, default: 1 },
    lastLogin: { type: Date, default: Date.now },
    stats: { type: Object, default: {} } // Dinamička statistika (npr. { vjesala: { wins: 5 } })
});
const User = mongoose.model('User', UserSchema);

// ONLINE KORISNICI
let onlineUsers = {};

io.on('connection', (socket) => {
    socket.on('login-success', (username) => {
        socket.username = username;
        onlineUsers[username] = { status: 'online', id: socket.id };
        io.emit('update-online-list', onlineUsers);
    });

    socket.on('change-status', (status) => {
        if (onlineUsers[socket.username]) {
            onlineUsers[socket.username].status = status;
            io.emit('update-online-list', onlineUsers);
        }
    });

    socket.on('send-msg', (text) => {
        if (socket.username) {
            io.emit('receive-msg', { user: socket.username, text });
        }
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            delete onlineUsers[socket.username];
            io.emit('update-online-list', onlineUsers);
        }
    });
});

// API: LOGIN / REGISTRACIJA
app.post('/api/login', async (req, res) => {
    const { username, password, secretKey, coupon } = req.body;
    try {
        let user = await User.findOne({ username });

        // REGISTRACIJA (Prva prijava)
        if (!user) {
            if (!secretKey) return res.status(400).json({ firstLogin: true });
            
            let initialGold = 0;
            if (coupon && coupon.trim().length > 0) initialGold = 50; // Bonus za kupon

            user = new User({ username, password, secretKey, coins: initialGold });
            await user.save();
            return res.json({ success: true, coins: user.coins, streak: user.loginStreak, stats: user.stats });
        }

        // LOGIN
        if (user.password === password) {
            const danas = new Date().toDateString();
            const zadnji = new Date(user.lastLogin).toDateString();

            if (danas !== zadnji) {
                user.loginStreak = (new Date() - new Date(user.lastLogin) < 86400000 * 2) ? user.loginStreak + 1 : 1;
                if (user.loginStreak > 7) user.loginStreak = 1; // Reset nakon 7 dana
                user.coins += (user.loginStreak * 10); // Veća nagrada svaki dan
                user.lastLogin = Date.now();
                await user.save();
            }
            res.json({ success: true, coins: user.coins, streak: user.loginStreak, stats: user.stats });
        } else {
            res.status(401).json({ success: false, message: "Netočna lozinka!" });
        }
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// API: DOHVATI TUĐI PROFIL
app.get('/api/user-stats/:username', async (req, res) => {
    const user = await User.findOne({ username: req.params.username }, 'username coins stats loginStreak');
    user ? res.json(user) : res.status(404).send();
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Arena aktivna na portu ${PORT}`));