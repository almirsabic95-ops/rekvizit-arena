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

const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    secretKey: { type: String, required: true },
    level: { type: Number, default: 0 },
    loginStreak: { type: Number, default: 1 },
    lastLogin: { type: Date, default: Date.now },
    stats: { 
        type: Object, 
        default: { vjesala: { level: 0, solved: 0 } } 
    }
});
const User = mongoose.model('User', UserSchema);

const vjesala = require('./kvizovi/vjesala');
vjesala.inicijalizirajVjesala(io);

// RUTA ZA LJESTVICU (Leaderboard)
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
    } catch (e) { res.status(500).json([]); }
});

app.post('/api/login', async (req, res) => {
    const { username, password, secretKey } = req.body;
    try {
        let user = await User.findOne({ username });
        if (!user) {
            if (!secretKey) return res.status(400).json({ firstLogin: true });
            user = new User({ 
                username, password, secretKey, 
                stats: { vjesala: { level: 0, solved: 0 } } 
            });
            await user.save();
        }
        if (user.password === password) {
            res.json({ 
                success: true, 
                username: user.username,
                level: user.level,
                streak: user.loginStreak,
                vStats: user.stats.vjesala || { level: 0, solved: 0 }
            });
        } else {
            res.status(401).json({ success: false, message: "Netočna lozinka!" });
        }
    } catch (err) { res.status(500).json({ success: false }); }
});

io.on('connection', (socket) => {
    socket.on('login-success', (username) => {
        socket.username = username;
    });
    socket.on('send-msg', (text) => {
        if (socket.username) io.emit('receive-msg', { user: socket.username, text });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Arena na portu ${PORT}`));