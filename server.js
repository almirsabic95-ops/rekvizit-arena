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
// Zamijeni <password> svojom lozinkom u Mongo Atlasu
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://rekvizit:arenakviz@rekvizit.o6ugw5r.mongodb.net/ArenaDB?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI)
    .then(() => console.log('Povezan na MongoDB Cloud 🚀'))
    .catch(err => console.error('Greška pri povezivanju na Mongo:', err));

// --- DEFINICIJA MODELA ---
const KorisnikSchema = new mongoose.Schema({
    nadimak: { type: String, required: true, unique: true },
    lozinka: { type: String, required: true },
    tajna_sifra: String,
    email: { type: String, default: "" },
    ukupni_bodovi: { type: Number, default: 0 },
    bedzevi: [String],
    streak: { type: Number, default: 0 },
    klan: { type: String, default: "Nema" },
    avatar: { type: String, default: "https://cdn-icons-png.flaticon.com/512/149/149071.png" },
    zadnja_aktivnost: { type: Date, default: Date.now }
});

const Korisnik = mongoose.model('Korisnik', KorisnikSchema);

app.use(express.static('.'));
app.use(express.json());

// --- GLOBALNE VARIJABLE ZA KVIZ ---
let trenutnoPitanje = null;
let pogodiliUovomKrugu = []; // Niz nadimaka igrača koji su točno odgovorili
let tajmer = 30;
let tajmerInterval = null;

// --- FUNKCIJA ZA NEPRESTANI KVIZ ---
async function pokreniBeskonacniKviz() {
    try {
        const kategorije = ['opce', 'povijest', 'sport', 'geografija'];
        const kat = kategorije[Math.floor(Math.random() * kategorije.length)];
        const putanja = path.join(__dirname, 'pitanja', `${kat}.json`);
        
        if (fs.existsSync(putanja)) {
            const pitanja = await fs.readJson(putanja);
            trenutnoPitanje = pitanja[Math.floor(Math.random() * pitanja.length)];
            trenutnoPitanje.kategorija = kat;
            trenutnoPitanje.tezina = trenutnoPitanje.tezina || "Lako";
            
            pogodiliUovomKrugu = []; // Resetiraj listu pobjednika kruga
            
            io.emit('novo_pitanje', { 
                pitanje: trenutnoPitanje.pitanje, 
                kategorija: kat, 
                tezina: trenutnoPitanje.tezina 
            });
            
            startTajmer();
        } else {
            // Ako fali datoteka, probaj opet za 5 sekundi
            setTimeout(pokreniBeskonacniKviz, 5000);
        }
    } catch (e) { 
        console.error("Greška u kviz petlji:", e); 
        setTimeout(pokreniBeskonacniKviz, 5000); 
    }
}

function startTajmer() {
    tajmer = 30;
    clearInterval(tajmerInterval);
    tajmerInterval = setInterval(async () => {
        tajmer--;
        io.emit('vrijeme_update', tajmer);

        // Provjera jesu li svi online igrači pogodili točno
        const onlineIgraci = Array.from(io.sockets.sockets.values()).filter(s => s.nadimak);
        if (onlineIgraci.length > 0 && pogodiliUovomKrugu.length >= onlineIgraci.length) {
            tajmer = 0; // Odmah završi ako su svi pogodili
        }

        if (tajmer <= 0) {
            clearInterval(tajmerInterval);
            io.emit('kraj_pitanja', { tocno: trenutnoPitanje ? trenutnoPitanje.odgovor : "---" });
            // Pauza od 3 sekunde prije novog pitanja
            setTimeout(pokreniBeskonacniKviz, 3000);
        }
    }, 1000);
}

// --- SOCKET.IO KOMUNIKACIJA ---
io.on('connection', (socket) => {
    
    // Login provjera
    socket.on('provjera_prijave', async (podaci) => {
        const korisnik = await Korisnik.findOne({ nadimak: podaci.nadimak });
        if (!korisnik) {
            socket.emit('odgovor_provjere', { status: 'novi_korisnik' });
        } else if (korisnik.lozinka === podaci.lozinka) {
            socket.emit('odgovor_provjere', { status: 'postojeci' });
        } else {
            socket.emit('odgovor_provjere', { status: 'greska', poruka: 'Pogrešna lozinka!' });
        }
    });

    // Registracija ili Finalni ulaz
    socket.on('finalna_prijava', async (podaci) => {
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
        socket.emit('prijavljen_uspjeh', u);
        azurirajOnlineListu();
    });

    // Slanje odgovora na kviz
    socket.on('slanje_odgovora', async (odgovor) => {
        if (!trenutnoPitanje || !socket.nadimak || pogodiliUovomKrugu.includes(socket.nadimak)) return;

        if (odgovor.toLowerCase().trim() === trenutnoPitanje.odgovor.toLowerCase().trim()) {
            const redniBroj = pogodiliUovomKrugu.length + 1;
            const isFirst = (redniBroj === 1);
            pogodiliUovomKrugu.push(socket.nadimak);

            // Dinamičko bodovanje po težini i redoslijedu
            let maxBodovi = trenutnoPitanje.tezina === "Teško" ? 50 : (trenutnoPitanje.tezina === "Srednje" ? 30 : 20);
            let postotak = isFirst ? (trenutnoPitanje.tezina === "Teško" ? 0.7 : (trenutnoPitanje.tezina === "Srednje" ? 0.6 : 0.5)) : 0.2;
            let osvojeno = Math.round(maxBodovi * postotak);

            const updejtovan = await Korisnik.findOneAndUpdate(
                { nadimak: socket.nadimak },
                { $inc: { ukupni_bodovi: osvojeno } },
                { new: true }
            );

            // Obavijesti sve tko je pogodio (za zvuk i chat)
            io.emit('igrac_pogodio', { 
                nadimak: socket.nadimak, 
                first: isFirst, 
                poredak: [...pogodiliUovomKrugu].reverse() // Zadnji koji je pogodio ide prvi na listu
            });
            
            azurirajOnlineListu();
        }
    });

    socket.on('chat_poruka_slanje', (tekst) => {
        if (socket.nadimak) {
            io.emit('chat_poruka_prijem', { nadimak: socket.nadimak, tekst: tekst });
        }
    });

    socket.on('zahtjev_oporavka_full', async (podaci) => {
        console.log("Zahtjev za oporavak primljen za:", podaci.nadimak);
        // Ovdje bi administrator u Atlasu vidio ove podatke
    });

    socket.on('disconnect', () => { azurirajOnlineListu(); });

    async function azurirajOnlineListu() {
        const sockets = Array.from(io.sockets.sockets.values()).filter(s => s.nadimak);
        const onlineNadimci = sockets.map(s => s.nadimak);
        
        const top10 = await Korisnik.find({ nadimak: { $in: onlineNadimci } })
                                    .sort({ ukupni_bodovi: -1 })
                                    .limit(10);

        io.emit('online_lista_update', {
            top: top10.map(t => ({ nadimak: t.nadimak, bodovi: t.ukupni_bodovi, avatar: t.avatar })),
            svi: onlineNadimci.map(n => ({ nadimak: n }))
        });
    }
});

pokreniBeskonacniKviz();
server.listen(PORT, () => console.log(`Arena aktivna na portu ${PORT}`));