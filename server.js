const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs-extra');

// --- KONFIGURACIJA NA VRHU ---
const PORT = 3000; // Definiramo port na vrhu radi lakše izmjene [cite: 2026-02-21]
const BODOVI_FILE = './bodovi.json';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('.'));
app.use(express.json());

// --- GLOBALNE VARIJABLE I TAJMERS ---
let trenutnoPitanje = null;
let odgovorenoPuta = 0;
let tajmerInterval = null;
let aktivnaKategorija = "";

// Logika za Profesora, Iznenadnu Borbu i Klanove
let trenutniProfesor = null;
let cooldownLista = new Map(); // Nadimak -> Vrijeme kraja hlađenja (2 sata) [cite: 2026-02-21]
let isIznenadnaBorbaAktivna = false;

// --- FUNKCIJA ZA BODOVANJE (Proširena za Klanove) ---
async function azurirajBodove(nadimak, osvojeniBodovi, kategorija, soba, klan) {
    const baza = await fs.readJson(BODOVI_FILE);
    
    // 1. Ukupni bodovi korisnika
    let korisnik = baza.korisnici.find(u => u.nadimak === nadimak);
    if (korisnik) {
        if (!korisnik.ukupni_bodovi) korisnik.ukupni_bodovi = 0;
        
        // --- LOGIKA ZA KLANOVE: Bodovi idu klanu samo u Clan Wars sobi --- [cite: 2026-02-21]
        // Ako igrač izađe iz klana, njegovi bodovi ostaju spremljeni pod tim klanom u bazi [cite: 2026-02-21]
        if (soba === 'clan_wars' && klan) {
            if (!korisnik.klan_stats) korisnik.klan_stats = {};
            if (!korisnik.klan_stats[klan]) korisnik.klan_stats[klan] = 0;
            korisnik.klan_stats[klan] += osvojeniBodovi;
        }

        korisnik.ukupni_bodovi += osvojeniBodovi;
        if (korisnik.ukupni_bodovi < 0) korisnik.ukupni_bodovi = 0;
    }

    // 2. Bodovi po kategoriji
    if (!baza.kategorije_stats[kategorija]) baza.kategorije_stats[kategorija] = [];
    let katStat = baza.kategorije_stats[kategorija].find(s => s.nadimak === nadimak);
    if (!katStat) {
        baza.kategorije_stats[kategorija].push({ nadimak: nadimak, bodovi: osvojeniBodovi });
    } else {
        katStat.bodovi += osvojeniBodovi;
    }

    // 3. Globalni Leaderboardi (Dnevni, Tjedni, Mjesečni, Ukupno)
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

    await fs.writeJson(BODOVI_FILE, baza, { spaces: 2 });
}

// --- SOCKET LOGIKA ---
io.on('connection', (socket) => {
    
    // --- PRIJAVA I IZNENADNA BORBA ---
    socket.on('prijava', async (podaci) => {
        const baza = await fs.readJson(BODOVI_FILE);
        let korisnik = baza.korisnici.find(u => u.nadimak === podaci.nadimak);

        if (!korisnik) {
            korisnik = { 
                nadimak: podaci.nadimak, 
                lozinka: podaci.lozinka, 
                tajna_sifra: podaci.tajna_sifra, 
                opomene: 0, 
                banovanDo: null,
                ukupni_bodovi: 0,
                titula: podaci.titula || null, // npr. "Profesor Učilice" [cite: 2026-02-21]
                klan: null
            };
            baza.korisnici.push(korisnik);
            await fs.writeJson(BODOVI_FILE, baza);
        }

        if (korisnik.banovanDo && korisnik.banovanDo > Date.now()) {
            socket.emit('ban_info', `Banovani ste do ${new Date(korisnik.banovanDo).toLocaleString()}`);
            return;
        }

        socket.nadimak = korisnik.nadimak;
        socket.titula = korisnik.titula;
        socket.klan = korisnik.klan;
        socket.emit('prijavljen', { nadimak: korisnik.nadimak, titula: korisnik.titula });

        // --- AUTOMATSKA IZNENADNA BORBA (Bivši Sudden Death) ---
        const sada = Date.now();
        if (socket.titula && (!cooldownLista.has(socket.nadimak) || sada > cooldownLista.get(socket.nadimak))) {
            socket.emit('start_iznenadna_borba');
            isIznenadnaBorbaAktivna = true;
            
            setTimeout(() => {
                cooldownLista.set(socket.nadimak, Date.now() + 7200000); // Hlađenje 2 sata [cite: 2026-02-21]
                isIznenadnaBorbaAktivna = false;
                socket.emit('kraj_iznenadne_borbe');
            }, 300000); // Traje 5 minuta [cite: 2026-02-21]
        }
    });

    // --- KVIZ I IZAZOV PROFESORA ---
    socket.on('start_kviz', async (kat) => {
        try {
            const putanja = `./pitanja/${kat}.json`;
            const pitanja = await fs.readJson(putanja);
            aktivnaKategorija = kat;
            
            // Logika Profesora: Prvi igrač s titulom u Učilici [cite: 2026-02-21]
            if (kat === 'ucilica' && !trenutniProfesor) {
                trenutniProfesor = socket.nadimak;
                io.emit('obavijest_profesor', `Profesor ${socket.nadimak} je online i spreman za izazov!`);
            }

            trenutnoPitanje = pitanja[Math.floor(Math.random() * pitanja.length)];
            odgovorenoPuta = 0;
            
            io.emit('novo_pitanje', { pitanje: trenutnoPitanje.pitanje });
            pokreniTajmer();
        } catch (e) {
            socket.emit('obavijest', "Kategorija još nema pitanja!");
        }
    });

    // --- SLANJE ODGOVORA I BODOVANJE ---
    socket.on('slanje_odgovora', async (odgovor) => {
        if (!trenutnoPitanje || !socket.nadimak) return;

        const tocan = trenutnoPitanje.odgovor.toLowerCase().trim();
        const upisano = odgovor.toLowerCase().trim();

        if (upisano === tocan) {
            odgovorenoPuta++;
            let bodovi = (odgovorenoPuta === 1) ? 7 : 5;
            
            if (socket.nadimak === trenutniProfesor) bodovi += 3; // Bonus za Profesora [cite: 2026-02-21]

            await azurirajBodove(socket.nadimak, bodovi, aktivnaKategorija, socket.soba, socket.klan);
            socket.emit('rezultat_odgovora', { točno: true, osvojeno: bodovi });
        } else {
            // Kazna u Iznenadnoj Borbi je -20 bodova [cite: 2026-02-21]
            let kazna = isIznenadnaBorbaAktivna ? -20 : -2;
            await azurirajBodove(socket.nadimak, kazna, aktivnaKategorija, socket.soba, socket.klan);
            socket.emit('rezultat_odgovora', { točno: false, osvojeno: kazna });
        }
    });

    // --- PRIVATNE PORUKE (PM) ---
    socket.on('posalji_privatnu_poruku', (data) => {
        const primatelj = Array.from(io.sockets.sockets.values()).find(s => s.nadimak === data.kome);
        if (primatelj) {
            primatelj.emit('prijem_privatne_poruke', { od: socket.nadimak, tekst: data.tekst });
            socket.emit('potvrda_privatne_poruke', { kome: data.kome, tekst: data.tekst });
        }
    });
});

// --- FUNKCIJA TAJMERA ---
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

// --- POKRETANJE NA PORTU DEFINIRANOM NA VRHU ---
server.listen(PORT, () => console.log(`Arena trči na http://localhost:${PORT}`)); // [cite: 2026-02-21]