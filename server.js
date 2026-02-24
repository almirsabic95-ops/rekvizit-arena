const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs-extra');

// --- KONFIGURACIJA ---
const PORT = 3000;
const BODOVI_FILE = './bodovi.json';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('.'));
app.use(express.json());

// --- GLOBALNE VARIJABLE ZA KVIZ ---
let trenutnoPitanje = null;
let odgovorenoPuta = 0;
let tajmerInterval = null;
let aktivnaKategorija = "";

// Logika za specijalne modove
let trenutniProfesor = null;
let isIznenadnaBorbaAktivna = false;

// Inicijalizacija baze podataka
if (!fs.existsSync(BODOVI_FILE)) {
    fs.writeJsonSync(BODOVI_FILE, { 
        korisnici: [], 
        leaderboard: { dnevni: [], tjedni: [], mjesecni: [], ukupno: [] },
        kategorije_stats: {} 
    });
}

// --- FUNKCIJA ZA BODOVANJE, BEDŽEVE I STREAK ---
async function azurirajBodove(nadimak, osvojeniBodovi, kategorija) {
    const baza = await fs.readJson(BODOVI_FILE);
    let u = baza.korisnici.find(k => k.nadimak === nadimak);
    
    if (u) {
        u.ukupni_bodovi = (u.ukupni_bodovi || 0) + osvojeniBodovi;
        if (u.ukupni_bodovi < 0) u.ukupni_bodovi = 0;

        // --- NOVO: SUSTAV BEDŽEVA (Milestones) ---
        if (!u.bedzevi) u.bedzevi = [];
        const pragovi = [
            { n: 'Star ⭐', p: 100 },
            { n: 'Champion 🏆', p: 500 },
            { n: 'Invincible 🛡️', p: 1000 },
            { n: 'Cosmic 🌌', p: 5000 }
        ];
        pragovi.forEach(prag => {
            if (u.ukupni_bodovi >= prag.p && !u.bedzevi.includes(prag.n)) {
                u.bedzevi.push(prag.n);
            }
        });

        // --- NOVO: STREAK LOGIKA (Vatra 🔥) ---
        u.streak = Math.floor(u.ukupni_bodovi / 250); 
    }
    
    await fs.writeJson(BODOVI_FILE, baza, { spaces: 2 });
    return u;
}

io.on('connection', (socket) => {
    console.log('Novi korisnik spojen');

    // 1. Prijava i Autentifikacija
    socket.on('provjera_prijave', async (podaci) => {
        try {
            const baza = await fs.readJson(BODOVI_FILE);
            let korisnik = baza.korisnici.find(u => u.nadimak === podaci.nadimak);
            
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
            console.error("Greška pri prijavi:", err);
        }
    });

    socket.on('finalna_prijava', async (podaci) => {
        const baza = await fs.readJson(BODOVI_FILE);
        let u = baza.korisnici.find(k => k.nadimak === podaci.nadimak);
        
        if (!u) {
            u = { 
                nadimak: podaci.nadimak, 
                lozinka: podaci.lozinka, 
                tajna_sifra: podaci.tajna_sifra,
                ukupni_bodovi: 0,
                bedzevi: [],
                streak: 0,
                klan: "Nema"
            };
            baza.korisnici.push(u);
            await fs.writeJson(BODOVI_FILE, baza);
        }
        
        socket.nadimak = u.nadimak;
        socket.klan = u.klan || "Nema";
        
        socket.emit('prijavljen_uspjeh', {
            nadimak: u.nadimak,
            coinsi: u.ukupni_bodovi,
            bedzevi: u.bedzevi || [],
            streak: u.streak || 0,
            klan: u.klan
        });
        
        io.emit('online_lista_update', Array.from(io.sockets.sockets.values())
            .filter(s => s.nadimak)
            .map(s => ({ nadimak: s.nadimak, klan: s.klan })));
    });

    // 2. Kviz Kontrola
    socket.on('start_kviz', async (kat) => {
        aktivnaKategorija = kat;
        try {
            const pitanja = await fs.readJson(`./pitanja/${kat}.json`);
            trenutnoPitanje = pitanja[Math.floor(Math.random() * pitanja.length)];
            odgovorenoPuta = 0;
            
            io.emit('novo_pitanje', { 
                pitanje: trenutnoPitanje.pitanje, 
                specijal: isIznenadnaBorbaAktivna ? 'borba' : (trenutniProfesor ? 'profesor' : 'normalno')
            });
            
            pokreniTajmer();
        } catch (e) {
            socket.emit('obavijest', "Greška pri učitavanju pitanja.");
        }
    });

    socket.on('slanje_odgovora', async (odgovor) => {
        if (!trenutnoPitanje || !socket.nadimak) return;
        
        if (odgovor.toLowerCase().trim() === trenutnoPitanje.odgovor.toLowerCase().trim()) {
            odgovorenoPuta++;
            let bodovi = 10;
            if (odgovorenoPuta === 1) bodovi = 20; // Bonus za najbržeg
            
            const updejtovan = await azurirajBodove(socket.nadimak, bodovi, aktivnaKategorija);
            
            socket.emit('prijavljen_uspjeh', {
                nadimak: updejtovan.nadimak,
                coinsi: updejtovan.ukupni_bodovi,
                bedzevi: updejtovan.bedzevi,
                streak: updejtovan.streak
            });
        }
    });

    // 3. Chat i Privatne Poruke
    socket.on('chat_poruka_slanje', (tekst) => {
        if (socket.nadimak) {
            io.emit('chat_poruka_prijem', { nadimak: socket.nadimak, tekst: tekst, klan: socket.klan });
        }
    });

    socket.on('zahtjev_oporavka', async (data) => {
        const baza = await fs.readJson(BODOVI_FILE);
        let k = baza.korisnici.find(u => u.nadimak === data.nadimak && u.tajna_sifra === data.tajna);
        socket.emit('obavijest', k ? `Lozinka: ${k.lozinka}` : "Pogrešni podaci!");
    });

    socket.on('disconnect', () => {
        io.emit('online_lista_update', Array.from(io.sockets.sockets.values())
            .filter(s => s.nadimak)
            .map(s => ({ nadimak: s.nadimak })));
    });
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

server.listen(PORT, () => console.log(`Arena aktivna na portu ${PORT}`));