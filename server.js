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
    .then(() => console.log("Povezan na MongoDB ✅"))
    .catch(err => console.error("Greška s bazom ❌:", err));

// Model Korisnika sa Tajnom Šifrom
const UserSchema = new mongoose.Schema({
    nadimak: { type: String, unique: true },
    lozinka: String,
    tajna_sifra: String, 
    bodovi: { type: Number, default: 0 }
});
const User = mongoose.model('User', UserSchema);

// Model za Zahtjeve (Adminu)
const RequestSchema = new mongoose.Schema({
    nadimak: String,
    poruka: String,
    vrijeme: { type: Date, default: Date.now }
});
const SupportRequest = mongoose.model('SupportRequest', RequestSchema);

app.use(express.static('.'));

io.on('connection', (socket) => {
    
    // Provjera postoji li korisnik
    socket.on('provjeri_postojanje', async (nadimak) => {
        try {
            const u = await User.findOne({ nadimak });
            socket.emit('odgovor_postojanja', { postoji: !!u });
        } catch (e) {
            console.log("Greška pri provjeri");
        }
    });

    // Prijava / Registracija
    socket.on('prijava', async (data) => {
        try {
            let u = await User.findOne({ nadimak: data.nadimak });

            if (!u) {
                // PRVA PRIJAVA - Korisnik bira svoju šifru
                if (data.tajna_sifra && data.tajna_sifra.length >= 3) {
                    u = new User({ 
                        nadimak: data.nadimak, 
                        lozinka: data.lozinka,
                        tajna_sifra: data.tajna_sifra 
                    });
                    await u.save();
                    socket.nadimak = u.nadimak;
                    socket.emit('prijavljen', { nadimak: u.nadimak });
                } else {
                    socket.emit('greska', "Za prvu prijavu odaberite vašu tajnu šifru!");
                }
            } else {
                // POSTOJEĆI KORISNIK
                if (u.lozinka === data.lozinka) {
                    socket.nadimak = u.nadimak;
                    socket.emit('prijavljen', { nadimak: u.nadimak });
                } else {
                    socket.emit('greska', "Pogrešna lozinka!");
                }
            }
        } catch (e) {
            socket.emit('greska', "Problem s bazom podataka.");
        }
    });

    socket.on('posalji_zahtjev', async (data) => {
        try {
            const novi = new SupportRequest({ nadimak: data.nadimak, poruka: data.poruka });
            await novi.save();
            socket.emit('zahtjev_primljen');
        } catch (e) {
            socket.emit('greska', "Greška pri slanju zahtjeva.");
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Arena online na portu ${PORT}`));