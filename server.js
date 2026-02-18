require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
app.use(express.static(__dirname));
const server = http.createServer(app);
const io = new Server(server);

mongoose.connect(process.env.MONGO_URI).then(() => console.log("Arena Server Spojen ✅"));

// MODEL KORISNIKA SA SVIM TRAŽENIM POLJIMA
const UserSchema = new mongoose.Schema({
    nadimak: { type: String, unique: true },
    lozinka: String,
    tajna_sifra: String,
    bodovi: { type: Number, default: 0 },
    bodoviDnevni: { type: Number, default: 0 },
    bodoviTjedni: { type: Number, default: 0 },
    bodoviMjesecni: { type: Number, default: 0 },
    coinsi: { type: Number, default: 500 },
    prihvacenaPravila: { type: Boolean, default: false },
    avatar: { type: String, default: 'default.png' },
    okvir: { type: String, default: 'none' },
    bedzevi: { type: Array, default: [] },
    kartice: { type: Array, default: [] },
    postignuca: { type: Array, default: [] },
    aktivniBedz: { type: String, default: '' },
    aktivniOkvir: { type: String, default: '' }
});

const User = mongoose.model('User', UserSchema);

// GLOBALNE VARIJABLE ZA KVIZ
let onlineKorisnici = {};
let trenutnoPitanje = null;
let pobjednikKruga = null;

const pitanjaBaza = [
    { p: "Koji uređaj radi na sloju 3 OSI modela?", o: "Router", kat: "Networking" },
    { p: "Što znači LLM?", o: "Large Language Model", kat: "Modern AI" },
    { p: "Koji protokol dodjeljuje IP adrese?", o: "DHCP", kat: "Networking" },
    { p: "Koji je port za HTTP?", o: "80", kat: "Web" }
];

function generirajPitanje() {
    trenutnoPitanje = pitanjaBaza[Math.floor(Math.random() * pitanjaBaza.length)];
    pobjednikKruga = null;
    io.emit('novo_pitanje', { tekst: trenutnoPitanje.p, kat: trenutnoPitanje.kat });
}
setInterval(generirajPitanje, 25000);

// LOGIN I REGISTRACIJA
io.on('connection', (socket) => {
    socket.on('pokusaj_prijave', async (data) => {
        let u = await User.findOne({ nadimak: data.nadimak });
        if (!u) {
            socket.emit('otvori_registraciju', { nadimak: data.nadimak });
        } else if (u.lozinka === data.lozinka) {
            ulogirajIgraca(u, socket);
        } else {
            socket.emit('greska', "Pogrešna lozinka!");
        }
    });

    socket.on('registracija', async (data) => {
        try {
            let u = new User({ 
                nadimak: data.nadimak, 
                lozinka: data.lozinka, 
                tajna_sifra: data.tajna_sifra,
                bedzevi: ["Novi Član"]
            });
            await u.save();
            ulogirajIgraca(u, socket);
        } catch(e) { socket.emit('greska', "Nadimak je već zauzet."); }
    });
    async function ulogirajIgraca(u, socket) {
        socket.nadimak = u.nadimak;
        onlineKorisnici[socket.id] = { 
            id: socket.id, 
            nadimak: u.nadimak, 
            bodovi: u.bodovi, 
            avatar: u.avatar, 
            aktivniBedz: u.aktivniBedz 
        };
        socket.emit('prijava_uspjesna', u);
        osveziSveListe();
    }

    async function osveziSveListe() {
        const topUkupno = await User.find().sort({ bodovi: -1 }).limit(10);
        const topDnevno = await User.find().sort({ bodoviDnevni: -1 }).limit(10);
        io.emit('update_leaderboard', { ukupno: topUkupno, dnevno: topDnevno });
        io.emit('update_online', Object.values(onlineKorisnici));
    }

    // DINAMIČKO BODOVANJE (50%, 60%, 70%)
    socket.on('slanje_odgovora', async (data) => {
        if (!trenutnoPitanje) return;
        let u = await User.findOne({ nadimak: socket.nadimak });
        let brojOnline = Object.keys(onlineKorisnici).length;

        if (data.odgovor.toLowerCase() === trenutnoPitanje.o.toLowerCase()) {
            let bazaBodova = 50;
            let postotakNajbrzi = 0.5;

            if (brojOnline > 30) postotakNajbrzi = 0.7;
            else if (brojOnline > 10) postotakNajbrzi = 0.6;

            let osvojeno;
            if (!pobjednikKruga) {
                pobjednikKruga = socket.nadimak;
                osvojeno = Math.floor(bazaBodova * postotakNajbrzi);
                io.emit('chat_msg', { od: "SISTEM", tekst: `🚀 ${u.nadimak} je bio najbrži!` });
            } else {
                osvojeno = Math.floor(bazaBodova * (1 - postotakNajbrzi));
            }

            u.bodovi += osvojeno;
            u.bodoviDnevni += osvojeno;
            u.coinsi += 5; 
            await u.save();
            socket.emit('update_stats', u);
            osveziSveListe();
        } else {
            u.bodovi = Math.max(0, u.bodovi - 2); // KAZNA -2
            await u.save();
            socket.emit('update_stats', u);
        }
    });

    socket.on('chat_global', (msg) => {
        io.emit('chat_msg', { od: socket.nadimak, tekst: msg });
    });

    socket.on('prihvati_uvjete', async () => {
        await User.findOneAndUpdate({ nadimak: socket.nadimak }, { prihvacenaPravila: true });
    });

    socket.on('disconnect', () => {
        delete onlineKorisnici[socket.id];
        osveziSveListe();
    });
});

server.listen(10000);