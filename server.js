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

// MONGODB ATLAS VEZA
const dbURI = "mongodb+srv://rekvizit:arenakviz@rekvizit.o6ugw5r.mongodb.net/RekvizitArena?retryWrites=true&w=majority&appName=Rekvizit";
mongoose.connect(dbURI).then(() => console.log('✅ Arena povezana na Cloud')).catch(err => console.log(err));

// MODEL KORISNIKA [cite: 2026-02-19]
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true },
    password: { type: String },
    secretKey: { type: String },
    couponUsed: { type: String, default: "" },
    coins: { type: Number, default: 0 },
    lastLogin: { type: Date, default: Date.now },
    loginStreak: { type: Number, default: 1 },
    region: { type: String, default: "Nepoznato" },
    stats: { type: Object, default: {} } // Dinamička statistika
});
const User = mongoose.model('User', UserSchema);

// SOCKET LOGIKA: Online lista i statusi
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

    socket.on('disconnect', () => {
        if (socket.username) {
            delete onlineUsers[socket.username];
            io.emit('update-online-list', onlineUsers);
        }
    });

    // Chat Lobby
    socket.on('send-msg', (data) => {
        io.emit('receive-msg', { user: socket.username, text: data });
    });
});

// API ZA LOGIN I KUPON
app.post('/api/login', async (req, res) => {
    const { username, password, secretKey, coupon } = req.body;
    let user = await User.findOne({ username });

    if (!user) {
        if (!secretKey) return res.status(400).json({ firstLogin: true });
        
        // Registracija s kuponom
        let initialCoins = 0;
        if (coupon && coupon.length > 2) initialCoins = 50; // Nagrada za kupon

        user = new User({ username, password, secretKey, couponUsed: coupon, coins: initialCoins });
        await user.save();
        return res.json({ success: true, message: "Dobrodošli u Arenu!" });
    }

    if (user.password === password) {
        // Logika za 7-dnevni bonus
        const today = new Date().toDateString();
        const last = new Date(user.lastLogin).toDateString();
        
        if (today !== last) {
            // Ovdje ide provjera za streak i dodjela coinsa
            user.lastLogin = Date.now();
            await user.save();
        }
        res.json({ success: true, stats: user.stats, coins: user.coins });
    } else {
        res.status(401).json({ success: false, message: "Pogrešna lozinka" });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server na portu ${PORT}`));