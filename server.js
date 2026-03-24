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

// MONGO DB ATLAS [cite: 2026-03-24]
const dbURI = "mongodb+srv://rekvizit:arenakviz@rekvizit.o6ugw5r.mongodb.net/RekvizitArena?retryWrites=true&w=majority&appName=Rekvizit";

mongoose.connect(dbURI)
    .then(() => console.log('✅ Povezano na MongoDB Atlas'))
    .catch(err => console.log('❌ Greška baze:', err));

const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    secretKey: { type: String, required: true },
    coins: { type: Number, default: 0 }
}));

// RUTA ZA STRANICU
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API LOGIN
app.post('/api/login', async (req, res) => {
    const { username, password, secretKey } = req.body;
    try {
        const user = await User.findOne({ username });
        if (!user) {
            if (!secretKey) return res.status(400).json({ firstLogin: true });
            const newUser = new User({ username, password, secretKey });
            await newUser.save();
            return res.json({ success: true });
        }
        if (user.password === password) return res.json({ success: true });
        res.status(401).json({ success: false, message: "Pogrešna lozinka" });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// RESET LOZINKE
app.post('/api/reset-password', async (req, res) => {
    const { username, secretKey, newPassword } = req.body;
    const user = await User.findOne({ username, secretKey });
    if (user) {
        user.password = newPassword;
        await user.save();
        res.json({ success: true, message: "Lozinka promijenjena" });
    } else {
        res.status(401).json({ success: false, message: "Neispravni podaci" });
    }
});

// SOCKET.IO - GLAVNI CHAT SERVERA
io.on('connection', (socket) => {
    socket.on('joinMainChat', (username) => {
        socket.username = username;
        io.emit('chatMessage', { user: 'Sustav', text: `${username} je ušao u Arenu.` });
    });

    socket.on('sendMainMessage', (text) => {
        io.emit('chatMessage', { user: socket.username, text: text });
    });

    socket.on('disconnect', () => {
        if(socket.username) {
            io.emit('chatMessage', { user: 'Sustav', text: `${socket.username} je napustio Arenu.` });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Arena na portu ${PORT}`));