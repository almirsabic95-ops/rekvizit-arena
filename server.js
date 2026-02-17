require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cron = require('node-cron');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- MONGO DB KONEKCIJA ---
mongoose.connect(process.env.MONGO_URI).then(() => console.log("Arena 2.0 Povezana ✅"));

// --- MODEL KORISNIKA (EKONOMIJA 2.0) ---
const UserSchema = new mongoose.Schema({
    nadimak: { type: String, unique: true },
    lozinka: String,
    bodovi: { type: Number, default: 0 },         // EXP (Tablica)
    coinsi: { type: Number, default: 1000 },      // Valuta za trošenje
    vauceri: { type: Number, default: 10 },       // "Zeleni novac"
    bodoviMjesecno: { type: Number, default: 0 },
    zadnjiLogin: { type: Date, default: new Date(0) },
    zadnjiSpin: { type: Date, default: new Date(0) },
    bedzevi: [String],
    statusKartice: { type: String, default: 'standard' }, // standard / gladijator
    bojaNadima: { type: String, default: '#ffffff' },
    aktivniOkvir: { type: String, default: 'none' }
});
const User = mongoose.model('User', UserSchema);

app.use(express.static('.'));

let onlineKorisnici = {}; 

// --- AUTOMATSKI RESETI ---
cron.schedule('0 0 1 * *', async () => {
    await User.updateMany({}, { bodoviMjesecno: 0 });
    console.log("Mjesečna tablica resetirana.");
});

// --- SOCKET LOGIKA ---
io.on('connection', (socket) => {
    
    socket.on('prijava', async (data) => {
        let u = await User.findOne({ nadimak: data.nadimak });
        if (u && u.lozinka === data.lozinka) {
            
            // Daily Login Bonus (500 Coinsa)
            const danas = new Date().toDateString();
            if (u.zadnjiLogin.toDateString() !== danas) {
                u.coinsi += 500;
                u.zadnjiLogin = new Date();
                await u.save();
                socket.emit('obavijest', "Dnevni bonus: +500 💰");
            }

            socket.nadimak = u.nadimak;
            onlineKorisnici[socket.id] = u;
            socket.emit('prijavljen', u);
            io.emit('osvezi_listu', Object.values(onlineKorisnici));
        }
    });

    // Kolo Sreće (Balansirano)
    socket.on('zavrti_kolo', async () => {
        let u = await User.findOne({ nadimak: socket.nadimak });
        const razlika = (new Date() - u.zadnjiSpin) / (1000 * 60 * 60);

        if (razlika >= 12) {
            const nagrade = [100, 100, 100, 200, 200, 500, 500, 1000, 5000];
            const dobiveno = nagrade[Math.floor(Math.random() * nagrade.length)];
            u.coinsi += dobiveno;
            u.zadnjiSpin = new Date();
            await u.save();
            socket.emit('kolo_rezultat', { iznos: dobiveno, novoStanje: u.coinsi });
        } else {
            socket.emit('greska', `Vrati se za ${Math.ceil(12 - razlika)}h.`);
        }
    });

    // Knjiga Kolekcionara
    socket.on('dohvati_kolekciju', async () => {
        let u = await User.findOne({ nadimak: socket.nadimak });
        const kolekcija = [
            { id: 'gladijator', naziv: 'Gladijator', uvjet: '5000 EXP', opis: 'Dobivaš oklop i zlatni profil.' },
            { id: 'munja', naziv: 'Munja', uvjet: 'Odgovor < 2s', opis: 'Efekt munje oko imena.' }
        ];
        socket.emit('vratka_kolekcije', { kolekcija, osvojeno: u.bedzevi });
    });

    // 1vs1 Izolacija
    socket.on('izazovi', (koga) => {
        const target = Object.keys(onlineKorisnici).find(id => onlineKorisnici[id].nadimak === koga);
        if (target) io.to(target).emit('izazov_stigao', { od: socket.nadimak });
    });

    socket.on('prihvati_duel', (protivnik) => {
        const soba = `room_${socket.nadimak}_${protivnik}`;
        socket.join(soba);
        const target = Object.keys(onlineKorisnici).find(id => onlineKorisnici[id].nadimak === protivnik);
        if (target) {
            io.sockets.sockets.get(target).join(soba);
            io.to(soba).emit('start_duel_efekt');
        }
    });

    socket.on('disconnect', () => {
        delete onlineKorisnici[socket.id];
        io.emit('osvezi_listu', Object.values(onlineKorisnici));
    });
});

server.listen(10000, () => console.log("Arena 2.0 spremna!"));