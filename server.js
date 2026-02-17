require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- MONGO DB POVEZIVANJE ---
const mongoURI = process.env.MONGO_URI;

mongoose.connect(mongoURI)
    .then(() => console.log("Povezan na MongoDB ✅"))
    .catch(err => console.error("Greška s bazom: ", err));

// Model Korisnika
const UserSchema = new mongoose.Schema({
    nadimak: { type: String, unique: true },
    lozinka: String,
    bodovi: { type: Number, default: 0 }
});
const User = mongoose.model('User', UserSchema);

// Model za Zahtjeve
const RequestSchema = new mongoose.Schema({
    nadimak: String,
    poruka: String,
    vrijeme: { type: Date, default: Date.now }
});
const SupportRequest = mongoose.model('SupportRequest', RequestSchema);

app.use(express.static('.'));

io.on('connection', (socket) => {
    console.log("Novi korisnik spojen");

    socket.on('provjeri_postojanje', async (nadimak) => {
        try {
            const u = await User.findOne({ nadimak });
            socket.emit('odgovor_postojanja', { postoji: !!u });
        } catch (e) {
            socket.emit('greska', "Baza nije dostupna (Provjeri MONGO_URI)");
        }
    });

    socket.on('prijava', async (data) => {
        try {
            let u = await User.findOne({ nadimak: data.nadimak });
            if (!u) {
                if (data.tajna_sifra === "ARENA2026") {
                    u = new User({ nadimak: data.nadimak, lozinka: data.lozinka });
                    await u.save();
                    socket.emit('prijavljen', { nadimak: u.nadimak });
                } else {
                    socket.emit('greska', "Prva prijava? Unesite ispravnu tajnu šifru!");
                }
            } else {
                if (u.lozinka === data.lozinka) {
                    socket.emit('prijavljen', { nadimak: u.nadimak });
                } else {
                    socket.emit('greska', "Pogrešna lozinka!");
                }
            }
        } catch (e) {
            socket.emit('greska', "Greška pri spajanju na bazu.");
        }
    });

    socket.on('posalji_zahtjev', async (data) => {
        try {
            const novi = new SupportRequest({ nadimak: data.nadimak, poruka: data.poruka });
            await novi.save();
            socket.emit('zahtjev_primljen');
        } catch (e) {
            socket.emit('greska', "Neuspješno slanje zahtjeva.");
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server radi na portu ${PORT}`));