require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- MONGO DB POVEZIVANJE ---
// Render koristi varijablu MONGO_URI iz Environment postavki
mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log("Povezan na MongoDB ✅"))
    .catch(err => console.error("Greška s bazom: Provjerite IP Whitelist u Atlasu! ❌", err));

const UserSchema = new mongoose.Schema({
    nadimak: { type: String, unique: true },
    lozinka: String,
    bodovi: { type: Number, default: 0 }
});
const User = mongoose.model('User', UserSchema);

const RequestSchema = new mongoose.Schema({
    nadimak: String,
    poruka: String,
    vrijeme: { type: Date, default: Date.now }
});
const SupportRequest = mongoose.model('SupportRequest', RequestSchema);

app.use(express.static('.'));

io.on('connection', (socket) => {
    
    socket.on('provjeri_postojanje', async (nadimak) => {
        try {
            const u = await User.findOne({ nadimak });
            socket.emit('odgovor_postojanja', { postoji: !!u });
        } catch (e) {
            console.log("Baza nije dostupna");
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
                    socket.emit('greska', "Pogrešna tajna šifra!");
                }
            } else if (u.lozinka === data.lozinka) {
                socket.emit('prijavljen', { nadimak: u.nadimak });
            } else {
                socket.emit('greska', "Pogrešna lozinka!");
            }
        } catch (e) {
            socket.emit('greska', "Sustav trenutno nije povezan s bazom.");
        }
    });

    socket.on('posalji_zahtjev', async (data) => {
        const noviZahtjev = new SupportRequest({ nadimak: data.nadimak, poruka: data.poruka });
        await noviZahtjev.save();
        socket.emit('zahtjev_primljen');
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Arena trči na portu ${PORT}`));