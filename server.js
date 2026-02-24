const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs-extra');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// --- POVEZIVANJE NA MONGO DB ---
// Ovdje zalijepi svoj URI iz MongoDB Atlasa
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://rekvizit:<db_password>@rekvizit.o6ugw5r.mongodb.net/?appName=Rekvizit';

mongoose.connect(MONGO_URI)
    .then(() => console.log('Povezan na MongoDB Cloud 🚀'))
    .catch(err => console.error('Greška pri povezivanju na Mongo:', err));

// --- DEFINICIJA MODELA (Shema korisnika) ---
const KorisnikSchema = new mongoose.Schema({
    nadimak: { type: String, required: true, unique: true },
    lozinka: { type: String, required: true },
    tajna_sifra: String,
    ukupni_bodovi: { type: Number, default: 0 },
    bedzevi: [String],
    streak: { type: Number, default: 0 },
    klan: { type: String, default: "Nema" }
});

const Korisnik = mongoose.model('Korisnik', KorisnikSchema);

app.use(express.static('.'));
app.use(express.json());

// --- KVIZ VARIJABLE ---
let trenutnoPitanje = null;
let tajmerInterval = null;

io.on('connection', (socket) => {
    console.log('Novi korisnik spojen');

    // 1. Provjera pri prijavi
    socket.on('provjera_prijave', async (podaci) => {
        try {
            const korisnik = await Korisnik.findOne({ nadimak: podaci.nadimak });
            
            if (!korisnik) {
                socket.emit('odgovor_provjere', { status: 'novi_korisnik' });
            } else {
                if (korisnik.lozinka === podaci.lozinka) {
                    socket.emit('odgovor_provjere', { status: 'postojeci' });
                } else {
                    socket.emit('odgovor_provjere', { status: 'greska', poruka: 'Pogrešna lozinka!' });
                }
            }
        } catch (err) {
            console.error(err);
            socket.emit('odgovor_provjere', { status: 'greska', poruka: 'Greška s bazom podataka.' });
        }
    });

    // 2. Finalna registracija ili login
    socket.on('finalna_prijava', async (podaci) => {
        try {
            let u = await Korisnik.findOne({ nadimak: podaci.nadimak });
            
            if (!u) {
                u = new Korisnik({ 
                    nadimak: podaci.nadimak, 
                    lozinka: podaci.lozinka, 
                    tajna_sifra: podaci.tajna_sifra 
                });
                await u.save();
            }
            
            socket.nadimak = u.nadimak;
            socket.emit('prijavljen_uspjeh', {
                nadimak: u.nadimak,
                coinsi: u.ukupni_bodovi,
                bedzevi: u.bedzevi,
                streak: u.streak
            });
            
            azurirajOnlineListu();
        } catch (err) {
            console.error(err);
        }
    });

    // 3. Kviz logika (Pitanja ostaju u JSON datotekama na serveru)
    socket.on('start_kviz', async (kat) => {
        try {
            const putanja = path.join(__dirname, 'pitanja', `${kat}.json`);
            if (fs.existsSync(putanja)) {
                const pitanja = await fs.readJson(putanja);
                trenutnoPitanje = pitanja[Math.floor(Math.random() * pitanja.length)];
                io.emit('novo_pitanje', { pitanje: trenutnoPitanje.pitanje });
                pokreniTajmer();
            }
        } catch (e) { console.log(e); }
    });

    socket.on('slanje_odgovora', async (odgovor) => {
        if (!trenutnoPitanje || !socket.nadimak) return;
        
        if (odgovor.toLowerCase().trim() === trenutnoPitanje.odgovor.toLowerCase().trim()) {
            const u = await Korisnik.findOneAndUpdate(
                { nadimak: socket.nadimak },
                { $inc: { ukupni_bodovi: 10 } },
                { new: true }
            );
            
            socket.emit('prijavljen_uspjeh', {
                nadimak: u.nadimak,
                coinsi: u.ukupni_bodovi,
                bedzevi: u.bedzevi,
                streak: u.streak
            });
        }
    });

    socket.on('chat_poruka_slanje', (tekst) => {
        if (socket.nadimak) {
            io.emit('chat_poruka_prijem', { nadimak: socket.nadimak, tekst: tekst });
        }
    });

    socket.on('disconnect', () => { azurirajOnlineListu(); });

    function azurirajOnlineListu() {
        const lista = Array.from(io.sockets.sockets.values())
            .filter(s => s.nadimak)
            .map(s => ({ nadimak: s.nadimak }));
        io.emit('online_lista_update', lista);
    }
});

function pokreniTajmer() {
    clearInterval(tajmerInterval);
    let sekunde = 30;
    tajmerInterval = setInterval(() => {
        io.emit('vrijeme_update', sekunde);
        if (sekunde <= 0) {
            clearInterval(tajmerInterval);
            io.emit('kraj_pitanja', { tocno: trenutnoPitanje ? trenutnoPitanje.odgovor : "---" });
            trenutnoPitanje = null;
        }
        sekunde--;
    }, 1000);
}

server.listen(PORT, () => console.log(`Arena na MongoDB-u aktivna na portu ${PORT}`));