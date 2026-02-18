require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));
app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html'); });

mongoose.connect(process.env.MONGO_URI).then(() => console.log("Arena Server Spojen ✅"));

const UserSchema = new mongoose.Schema({
    nadimak: { type: String, unique: true },
    lozinka: String,
    tajna_sifra: String,
    bodovi: { type: Number, default: 0 },
    bodoviDnevni: { type: Number, default: 0 },
    bodoviTjedni: { type: Number, default: 0 },
    bodoviMjesecni: { type: Number, default: 0 },
    coinsi: { type: Number, default: 1000 },
    brojIzazova: { type: Number, default: 0 }, // Za bedževe
    avatar: { type: String, default: 'https://i.imgur.com/6VBx3io.png' },
    aktivniBedz: { type: String, default: '' },
    ikonice: { type: Array, default: [] }
});

const User = mongoose.model('User', UserSchema);

const pitanjaBaza = [
    { p: "Koji je glavni grad Brazila?", o: "Brazilija", kat: "Geografija" },
    { p: "Koja planeta je poznata kao Crveni planet?", o: "Mars", kat: "Nauka" },
    { p: "Koliko igrača ima u nogometnom timu na terenu?", o: "11", kat: "Sport" },
    { p: "Koja je kemijska oznaka za vodu?", o: "H2O", kat: "Kemija" },
    { p: "Tko je naslikao Mona Lisu?", o: "Leonardo da Vinci", kat: "Umjetnost" },
    { p: "Koji uređaj spaja LAN i WAN mreže?", o: "Router", kat: "IT" }
];

let trenutnoPitanje = null;
let onlineKorisnici = {};
let timerSekunde = 30;
let pobjednikKruga = null;
function pokreniTimer() {
    timerSekunde = 30;
    generirajPitanje();
    const interval = setInterval(() => {
        timerSekunde--;
        io.emit('timer_update', timerSekunde);
        if (timerSekunde <= 0) {
            clearInterval(interval);
            setTimeout(pokreniTimer, 3000); // Pauza 3s prije novog pitanja
        }
    }, 1000);
}

function generirajPitanje() {
    trenutnoPitanje = pitanjaBaza[Math.floor(Math.random() * pitanjaBaza.length)];
    pobjednikKruga = null;
    io.emit('novo_pitanje', { tekst: trenutnoPitanje.p, kat: trenutnoPitanje.kat });
}

// Pokreni sustav čim se server digne
pokreniTimer();

io.on('connection', (socket) => {
    socket.on('pokusaj_prijave', async (data) => {
        let u = await User.findOne({ nadimak: data.nadimak });
        if (!u) { socket.emit('otvori_registraciju', { nadimak: data.nadimak }); }
        else if (u.lozinka === data.lozinka) { ulogirajIgraca(u, socket); }
        else { socket.emit('greska', "Pogrešna lozinka!"); }
    });

    socket.on('registracija', async (data) => {
        try {
            let u = new User({ nadimak: data.nadimak, lozinka: data.lozinka, tajna_sifra: data.tajna_sifra });
            await u.save();
            ulogirajIgraca(u, socket);
        } catch(e) { socket.emit('greska', "Greška pri registraciji."); }
    });

    async function ulogirajIgraca(u, socket) {
        socket.nadimak = u.nadimak;
        onlineKorisnici[socket.id] = { id: socket.id, nadimak: u.nadimak, bodovi: u.bodovi, avatar: u.avatar, aktivniBedz: u.aktivniBedz };
        socket.emit('prijava_uspjesna', u);
        osveziSveListe();
    }
    socket.on('slanje_odgovora', async (data) => {
        if (!trenutnoPitanje) return;
        let u = await User.findOne({ nadimak: socket.nadimak });
        
        if (data.odgovor.toLowerCase() === trenutnoPitanje.o.toLowerCase()) {
            let brojOnline = Object.keys(onlineKorisnici).length;
            let postotak = brojOnline > 30 ? 0.7 : (brojOnline > 10 ? 0.6 : 0.5);
            let bodovi = 50;

            if (!pobjednikKruga) {
                pobjednikKruga = socket.nadimak;
                u.bodovi += Math.floor(bodovi * postotak);
                io.emit('chat_msg', { od: "SISTEM", tekst: `✅ ${u.nadimak} je pogodio prvi!` });
            } else {
                u.bodovi += Math.floor(bodovi * (1 - postotak));
            }
            u.coinsi += 10;
        } else {
            u.bodovi = Math.max(0, u.bodovi - 2);
        }
        await u.save();
        socket.emit('update_stats', u);
        osveziSveListe();
    });

    // SISTEM IZAZOVA I BEDŽEVA
    socket.on('izazovi_igraca', async (targetId) => {
        let izazivac = await User.findOne({ nadimak: socket.nadimak });
        izazivac.brojIzazova += 1;

        // Provjera bedževa
        if (izazivac.brojIzazova === 100) izazivac.aktivniBedz = "🥉 Bronca";
        if (izazivac.brojIzazova === 1000) izazivac.aktivniBedz = "🥈 Srebro";
        if (izazivac.brojIzazova === 10000) izazivac.aktivniBedz = "🥇 Zlato";

        await izazivac.save();
        io.to(targetId).emit('dobio_izazov', { od: socket.nadimak, odId: socket.id });
    });

    async function osveziSveListe() {
        const top = await User.find().sort({ bodovi: -1 }).limit(100);
        io.emit('update_leaderboard', top);
        io.emit('update_online', Object.values(onlineKorisnici));
    }

    socket.on('chat_global', msg => io.emit('chat_msg', { od: socket.nadimak, tekst: msg }));
    socket.on('disconnect', () => { delete onlineKorisnici[socket.id]; osveziSveListe(); });
});

server.listen(10000);