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

// --- 1. DEFINICIJA MODELA (Izmijenjeno za Level sustav) ---
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    secretKey: { type: String, required: true },
    level: { type: Number, default: 0 },         // Počinješ od levela 0
    solvedWords: { type: Number, default: 0 },   // Brojač pogođenih riječi
    loginStreak: { type: Number, default: 1 },
    lastLogin: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

// --- 2. UCITAVANJE KVIZA ---
const vjesala = require('./kvizovi/vjesala');
vjesala.inicijalizirajVjesala(io);

let onlineUsers = {};

io.on('connection', (socket) => {
    socket.on('login-success', (username) => {
        socket.username = username;
        onlineUsers[username] = { status: 'online', id: socket.id };
        io.emit('update-online-list', onlineUsers);
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

app.get('/kvizovi/vjesala', (req, res) => {
    res.sendFile(path.join(__dirname, 'kvizovi', 'vjesala.html'));
});

// LOGIN RUTA (Popravljena za Level sustav)
app.post('/api/login', async (req, res) => {
    const { username, password, secretKey } = req.body;
    try {
        let user = await User.findOne({ username });

        if (!user) {
            if (!secretKey) return res.status(400).json({ firstLogin: true });
            user = new User({ 
                username, password, secretKey, 
                level: 0, solvedWords: 0, 
                lastLogin: new Date() 
            });
            await user.save();
            return res.json({ success: true, level: 0, solved: 0, username: user.username });
        }

        if (user.password === password) {
            res.json({ 
                success: true, 
                level: user.level, 
                solved: user.solvedWords,
                username: user.username 
            });
        } else {
            res.status(401).json({ success: false, message: "Netočna lozinka!" });
        }
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Arena na portu ${PORT}`));