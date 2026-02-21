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
let cooldownLista = new Map(); 
let isIznenadnaBorbaAktivna = false;

// Inicijalizacija baze podataka
if (!fs.existsSync(BODOVI_FILE)) {
    fs.writeJsonSync(BODOVI_FILE, { 
        korisnici: [], 
        leaderboard: { dnevni: [], tjedni: [], mjesecni: [], ukupno: [] },
        kategorije_stats: {} 
    });
}

// --- FUNKCIJA ZA BODOVANJE (Sa klanovima i statsima) ---
async function azurirajBodove(nadimak, osvojeniBodovi, kategorija, soba, klan) {
    const baza = await fs.readJson(BODOVI_FILE);
    let korisnik = baza.korisnici.find(u => u.nadimak === nadimak);
    
    if (korisnik) {
        if (!korisnik.ukupni_bodovi) korisnik.ukupni_bodovi = 0;
        
        // Logika za Klanove
        if (soba === 'clan_wars' && klan) {
            if (!korisnik.klan_stats) korisnik.klan_stats = {};
            if (!korisnik.klan_stats[klan]) korisnik.klan_stats[klan] = 0;
            korisnik.klan_stats[klan] += osvojeniBodovi;
        }

        korisnik.ukupni_bodovi += osvojeniBodovi;
        if (korisnik.ukupni_bodovi < 0) korisnik.ukupni_bodovi = 0;

        // Bodovi po kategoriji
        if (!baza.kategorije_stats[kategorija]) baza.kategorije_stats[kategorija] = [];
        let katStat = baza.kategorije_stats[kategorija].find(s => s.nadimak === nadimak);
        if (!katStat) {
            baza.kategorije_stats[kategorija].push({ nadimak: nadimak, bodovi: osvojeniBodovi });
        } else {
            katStat.bodovi += osvojeniBodovi;
        }

        // Ažuriranje leaderboarda
        const tipovi = ['dnevni', 'tjedni', 'mjesecni', 'ukupno'];
        tipovi.forEach(tip => {
            let lb = baza.leaderboard[tip].find(l => l.nadimak === nadimak);
            if (!lb) {
                baza.leaderboard[tip].push({ nadimak: nadimak, bodovi: osvojeniBodovi });
            } else {
                lb.bodovi += osvojeniBodovi;
            }
            baza.leaderboard[tip].sort((a, b) => b.bodovi - a.bodovi);
        });
    }
    await fs.writeJson(BODOVI_FILE, baza, { spaces: 2 });
}

// --- SOCKET LOGIKA ---
io.on('connection', (socket) => {
    
    // 1. Provjera pri prijavi (Novo!)
    socket.on('provjera_prijave', async (podaci) => {
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
    });

    // 2. Finalna prijava (Spremanje tajne šifre)
    socket.on('finalna_prijava', async (podaci) => {
        const baza = await fs.readJson(BODOVI_FILE);
        let korisnik = baza.korisnici.find(u => u.nadimak === podaci.nadimak);

        if (!korisnik) {
            korisnik = {
                nadimak: podaci.nadimak,
                lozinka: podaci.lozinka,
                tajna_sifra: podaci.tajna_sifra,
                ukupni_bodovi: 0,
                titula: null,
                klan: null,
                banovanDo: null
            };
            baza.korisnici.push(korisnik);
            await fs.writeJson(BODOVI_FILE, baza);
        }

        socket.nadimak = korisnik.nadimak;
        socket.titula = korisnik.titula;
        socket.klan = korisnik.klan;
        socket.emit('prijavljen', { nadimak: korisnik.nadimak });

        // Provjera za Iznenadnu borbu
        const sada = Date.now();
        if (socket.titula && (!cooldownLista.has(socket.nadimak) || sada > cooldownLista.get(socket.nadimak))) {
            socket.emit('start_iznenadna_borba');
            isIznenadnaBorbaAktivna = true;
            setTimeout(() => {
                cooldownLista.set(socket.nadimak, Date.now() + 7200000);
                isIznenadnaBorbaAktivna = false;
                socket.emit('kraj_iznenadne_borbe');
            }, 300000);
        }
    });

    // 3. Logika Kviza
    socket.on('start_kviz', async (kat) => {
        try {
            const putanja = `./pitanja/${kat}.json`;
            const pitanja = await fs.readJson(putanja);
            aktivnaKategorija = kat;
            
            if (kat === 'ucilica' && !trenutniProfesor) {
                trenutniProfesor = socket.nadimak;
                io.emit('obavijest_profesor', `Profesor ${socket.nadimak} je u kabinetu!`);
            }

            trenutnoPitanje = pitanja[Math.floor(Math.random() * pitanja.length)];
            odgovorenoPuta = 0;
            io.emit('novo_pitanje', { pitanje: trenutnoPitanje.pitanje });
            pokreniTajmer();
        } catch (e) {
            socket.emit('obavijest', "Greška pri učitavanju pitanja.");
        }
    });

    socket.on('slanje_odgovora', async (odgovor) => {
        if (!trenutnoPitanje || !socket.nadimak) return;

        const tocan = trenutnoPitanje.odgovor.toLowerCase().trim();
        const upisano = odgovor.toLowerCase().trim();

        if (upisano === tocan) {
            odgovorenoPuta++;
            let bodovi = (odgovorenoPuta === 1) ? 7 : 5;
            if (socket.nadimak === trenutniProfesor) bodovi += 3;

            await azurirajBodove(socket.nadimak, bodovi, aktivnaKategorija, socket.soba, socket.klan);
            socket.emit('rezultat_odgovora', { točno: true, osvojeno: bodovi });
        } else {
            let kazna = isIznenadnaBorbaAktivna ? -20 : -2;
            await azurirajBodove(socket.nadimak, kazna, aktivnaKategorija, socket.soba, socket.klan);
            socket.emit('rezultat_odgovora', { točno: false, osvojeno: kazna });
        }
    });

    // 4. Privatne poruke i Oporavak
    socket.on('posalji_privatnu_poruku', (data) => {
        const primatelj = Array.from(io.sockets.sockets.values()).find(s => s.nadimak === data.kome);
        if (primatelj) {
            primatelj.emit('prijem_privatne_poruke', { od: socket.nadimak, tekst: data.tekst });
        }
    });

    socket.on('zahtjev_oporavka', async (data) => {
        const baza = await fs.readJson(BODOVI_FILE);
        let korisnik = baza.korisnici.find(u => u.nadimak === data.nadimak && u.tajna_sifra === data.tajna);
        socket.emit('obavijest', korisnik ? `Lozinka: ${korisnik.lozinka}` : "Pogrešni podaci!");
    });
});

function pokreniTajmer() {
    clearInterval(tajmerInterval);
    let sekunde = 30;
    tajmerInterval = setInterval(() => {
        io.emit('vrijeme', sekunde);
        if (sekunde <= 0) {
            clearInterval(tajmerInterval);
            io.emit('kraj_pitanja');
            trenutnoPitanje = null;
        }
        sekunde--;
    }, 1000);
}

server.listen(PORT, () => console.log(`Arena aktivna na portu ${PORT}`));