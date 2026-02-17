require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- MONGO DB POVEZIVANJE ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("Povezan na MongoDB"))
    .catch(err => console.error("Greška s bazom:", err));

// Model Korisnika
const UserSchema = new mongoose.Schema({
    nadimak: { type: String, unique: true },
    lozinka: String,
    bodovi: { type: Number, default: 0 },
    isShadowBanned: { type: Boolean, default: false }
});
const User = mongoose.model('User', UserSchema);

// Model za Zahtjeve (Zaboravljena lozinka)
const RequestSchema = new mongoose.Schema({
    nadimak: String,
    poruka: String,
    vrijeme: { type: Date, default: Date.now }
});
const SupportRequest = mongoose.model('SupportRequest', RequestSchema);

app.use(express.static('.'));

let trenutnoPitanje = null;
let tajmerInterval = null;

io.on('connection', (socket) => {
    
    // Provjera postoji li korisnik (za prikaz tajne šifre)
    socket.on('provjeri_postojanje', async (nadimak) => {
        const u = await User.findOne({ nadimak });
        socket.emit('odgovor_postojanja', { postoji: !!u });
    });

    socket.on('prijava', async (data) => {
        let u = await User.findOne({ nadimak: data.nadimak });

        if (!u) {
            // Prva prijava - registracija
            if (data.tajna_sifra === "ARENA2026") {
                u = new User({ nadimak: data.nadimak, lozinka: data.lozinka });
                await u.save();
                prijaviIgraca(socket, u);
            } else {
                socket.emit('greska', "Pogrešna tajna šifra za prvu registraciju!");
            }
        } else {
            // Postojeći korisnik
            if (u.lozinka === data.lozinka) {
                prijaviIgraca(socket, u);
            } else {
                socket.emit('greska', "Pogrešna lozinka!");
            }
        }
    });

    socket.on('posalji_zahtjev', async (data) => {
        const noviZahtjev = new SupportRequest({ nadimak: data.nadimak, poruka: data.poruka });
        await noviZahtjev.save();
        socket.emit('zahtjev_primljen');
    });

    // Ostatak tvoje logike za kviz (iz starog server.js)
});

function prijaviIgraca(socket, user) {
    socket.nadimak = user.nadimak;
    socket.isShadowBanned = user.isShadowBanned;
    socket.emit('prijavljen', { nadimak: user.nadimak });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Arena trči na portu ${PORT}`));