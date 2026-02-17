require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cron = require('node-cron');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

mongoose.connect(process.env.MONGO_URI).then(() => console.log("Arena 2.0 Povezana ✅"));

// --- MODEL KORISNIKA (Sačuvani bodovi + Nova polja) ---
const UserSchema = new mongoose.Schema({
    nadimak: { type: String, unique: true },
    lozinka: String,
    tajna_sifra: String,
    bodovi: { type: Number, default: 0 },         
    coinsi: { type: Number, default: 1000 },      
    vauceri: { type: Number, default: 10 },
    pobjede1vs1: { type: Number, default: 0 },
    ukupnoTocnih: { type: Number, default: 0 },
    bedzevi: { type: [String], default: [] },
    aktivniBedz: { type: String, default: 'standard' },
    zadnjiLogin: { type: Date, default: new Date(0) },
    zadnjiSpin: { type: Date, default: new Date(0) },
    avatar: { type: String, default: 'https://i.imgur.com/6VBx3io.png' }
});
const User = mongoose.model('User', UserSchema);

app.use(express.static('.'));

let onlineKorisnici = {}; 
let trenutnoPitanje = null;

// --- AUTOMATSKI KVIZ (Vrti se stalno) ---
const pitanjaBaza = [
    { p: "Koji je glavni grad Bosne i Hercegovine?", o: "Sarajevo" },
    { p: "Koja je najveća planeta u Sunčevom sistemu?", o: "Jupiter" },
    { p: "Koliko kontinenata postoji na Zemlji?", o: "7" },
    { p: "Koji element ima simbol 'O' u periodnom sistemu?", o: "Kisik" }
];

function novoPitanje() {
    trenutnoPitanje = pitanjaBaza[Math.floor(Math.random() * pitanjaBaza.length)];
    io.emit('novo_pitanje', { tekst: trenutnoPitanje.p });
}
setInterval(novoPitanje, 30000); // Svakih 30s novo pitanje
setTimeout(novoPitanje, 5000);

// FUNKCIJA ZA PROVJERU KARTICA/POSTIGNUĆA
async function provjeriPostignuca(u, socket) {
    let osvojeno = false;
    const uvjeti = [
        { ime: "Gladijator", uvjet: u.pobjede1vs1 >= 50 },
        { ime: "Enciklopedija", uvjet: u.ukupnoTocnih >= 100 },
        { ime: "Milijunaš", uvjet: u.coinsi >= 100000 },
        { ime: "Veteran", uvjet: u.bodovi >= 5000 }
    ];

    uvjeti.forEach(item => {
        if (item.uvjet && !u.bedzevi.includes(item.ime)) {
            u.bedzevi.push(item.ime);
            u.aktivniBedz = item.ime;
            osvojeno = true;
            io.emit('chat_broadcast', { od: "SISTEM", tekst: `🌟 ${u.nadimak} je osvojio karticu: ${item.ime}!`, tip: 'global' });
        }
    });
    if (osvojeno) await u.save();
}

io.on('connection', (socket) => {
    socket.on('prijava', async (data) => {
        let u = await User.findOne({ nadimak: data.nadimak });
        if (u && u.lozinka === data.lozinka && u.tajna_sifra === data.tajna_sifra) {
            const danas = new Date().toDateString();
            if (u.zadnjiLogin.toDateString() !== danas) {
                u.coinsi += 500; u.zadnjiLogin = new Date(); await u.save();
                socket.emit('obavijest', "Dnevni bonus: +500 💰");
            }
            socket.nadimak = u.nadimak;
            onlineKorisnici[socket.id] = u;
            socket.emit('prijavljen', u);
            if(trenutnoPitanje) socket.emit('novo_pitanje', { tekst: trenutnoPitanje.p });
            io.emit('osvezi_listu', Object.values(onlineKorisnici));
        } else { socket.emit('greska', "Pogrešni podaci!"); }
    });

    socket.on('slanje_odgovora', async (data) => {
        if (trenutnoPitanje && data.odgovor.toLowerCase() === trenutnoPitanje.o.toLowerCase()) {
            let u = await User.findOne({ nadimak: socket.nadimak });
            u.ukupnoTocnih += 1; u.coinsi += 50; u.bodovi += 10;
            await u.save();
            io.emit('chat_broadcast', { od: "SISTEM", tekst: `✅ ${socket.nadimak} je pogodio! (+50 💰)`, tip: 'global' });
            await provjeriPostignuca(u, socket);
            novoPitanje();
        }
    });

    socket.on('zavrti_kolo', async () => {
        let u = await User.findOne({ nadimak: socket.nadimak });
        const nagrade = [100, 200, 500, 1000, 100, 5000, 200, 100];
        const idx = Math.floor(Math.random() * nagrade.length);
        u.coinsi += nagrade[idx]; u.zadnjiSpin = new Date(); await u.save();
        socket.emit('kolo_rezultat', { index: idx, iznos: nagrade[idx], novoStanje: u.coinsi });
    });

    socket.on('chat_global', (msg) => {
        io.emit('chat_broadcast', { od: socket.nadimak, tekst: msg, tip: 'global' });
    });

    socket.on('pogledaj_profil', async (nad) => {
        let u = await User.findOne({ nadimak: nad });
        socket.emit('prikaz_profila', u);
    });

    socket.on('disconnect', () => {
        delete onlineKorisnici[socket.id];
        io.emit('osvezi_listu', Object.values(onlineKorisnici));
    });
});

server.listen(10000, () => console.log("Arena Online!"));