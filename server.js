const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs-extra');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const BODOVI_FILE = './bodovi.json';

app.use(express.static('.'));
app.use(express.json());

let trenutnoPitanje = null;
let odgovorenoPuta = 0;
let tajmerInterval = null;
let aktivnaKategorija = "";
let tacniOdgovoriUKrugu = [];
let onlineKorisnici = {};

// Osiguraj bazu podataka
if (!fs.existsSync(BODOVI_FILE)) {
    fs.writeJsonSync(BODOVI_FILE, { 
        korisnici: [], 
        zahtjevi_oporavak: [], 
        leaderboard: { dnevni: [], tjedni: [], ukupno: [] },
        kategorije_stats: {}
    });
}

// --- TVOJA ORIGINALNA FUNKCIJA ZA BODOVANJE (Zadržana u potpunosti) ---
async function azurirajBodove(nadimak, osvojeniBodovi, kategorija) {
    try {
        const baza = await fs.readJson(BODOVI_FILE);
        let korisnik = baza.korisnici.find(u => u.nadimak === nadimak);
        if (korisnik) {
            if (!korisnik.ukupni_bodovi) korisnik.ukupni_bodovi = 0;
            korisnik.ukupni_bodovi = Math.max(0, korisnik.ukupni_bodovi + osvojeniBodovi);
        }

        if (!baza.kategorije_stats[kategorija]) baza.kategorije_stats[kategorija] = [];
        let katStat = baza.kategorije_stats[kategorija].find(s => s.nadimak === nadimak);
        if (!katStat) {
            baza.kategorije_stats[kategorija].push({ nadimak: nadimak, bodovi: Math.max(0, osvojeniBodovi) });
        } else {
            katStat.bodovi = Math.max(0, katStat.bodovi + osvojeniBodovi);
        }

        const tipovi = ['dnevni', 'tjedni', 'ukupno'];
        tipovi.forEach(tip => {
            if(!baza.leaderboard[tip]) baza.leaderboard[tip] = [];
            let lb = baza.leaderboard[tip].find(l => l.nadimak === nadimak);
            if (!lb) {
                baza.leaderboard[tip].push({ nadimak: nadimak, bodovi: Math.max(0, osvojeniBodovi) });
            } else {
                lb.bodovi = Math.max(0, lb.bodovi + osvojeniBodovi);
            }
            baza.leaderboard[tip].sort((a, b) => b.bodovi - a.bodovi);
        });

        await fs.writeJson(BODOVI_FILE, baza, { spaces: 2 });
    } catch (err) {
        console.error("Greška pri upisu bodova:", err);
    }
}

// --- SUSTAV POSTIGNUĆA (Ikone, Bedževi, Kartice) ---
async function provjeriPostignuca(korisnik, tip) {
    let obavijest = null;
    if (!korisnik.postignuca) korisnik.postignuca = [];

    if (tip === 'niz' && korisnik.trenutniNiz === 5 && !korisnik.postignuca.includes('vatra')) {
        korisnik.postignuca.push('vatra');
        obavijest = `🔥 Igrač ${korisnik.nadimak} je pogodio 5 pitanja u nizu i dobio ikonicu VATRA!`;
    } else if (tip === 'niz' && korisnik.trenutniNiz === 10 && !korisnik.postignuca.includes('kruna')) {
        korisnik.postignuca.push('kruna');
        obavijest = `👑 KRALJ ARENE: ${korisnik.nadimak} je vezao 10 točnih odgovora!`;
    } else if (tip === 'bogatas' && korisnik.coinsi >= 5000 && !korisnik.postignuca.includes('dijamant')) {
        korisnik.postignuca.push('dijamant');
        obavijest = `💎 ${korisnik.nadimak} je postao bogataš sa preko 5000 coinsa i dobio dijamantnu karticu!`;
    }
    return obavijest;
}

// --- DAILY LOGIN BONUS (7 dana niz) ---
async function provjeriDailyBonus(korisnik) {
    const danas = new Date().toDateString();
    const jucer = new Date(Date.now() - 86400000).toDateString();
    if (korisnik.zadnji_login === danas) return null;

    if (korisnik.zadnji_login === jucer) {
        korisnik.nizLogina = (korisnik.nizLogina % 7) + 1;
    } else {
        korisnik.nizLogina = 1;
    }
    let nagrada = korisnik.nizLogina * 100;
    korisnik.coinsi = (korisnik.coinsi || 0) + nagrada;
    korisnik.zadnji_login = danas;
    return { nagrada, dan: korisnik.nizLogina };
}
// KVIZ LOGIKA (TVOJA ORIGINALNA LOGIKA)
    socket.on('start_kviz', async (kat) => {
        try {
            const putanja = `./pitanja/${kat}.json`;
            const pitanja = await fs.readJson(putanja);
            aktivnaKategorija = kat;
            trenutnoPitanje = pitanja[Math.floor(Math.random() * pitanja.length)];
            odgovorenoPuta = 0;
            tacniOdgovoriUKrugu = [];
            io.emit('novo_pitanje', { pitanje: trenutnoPitanje.pitanje, kategorija: kat });
            pokreniTajmer();
        } catch (e) { socket.emit('obavijest', "Kategorija nema pitanja!"); }
    });

    socket.on('slanje_odgovora', async (odgovor) => {
        if (!trenutnoPitanje || !socket.nadimak) return;
        const tocan = trenutnoPitanje.odgovor.toLowerCase().trim();
        const upisano = odgovor.toLowerCase().trim();

        // Prikaz svima što je igrač odgovorio
        io.emit('chat_poruka', { igrac: socket.nadimak, tekst: upisano });

        const baza = await fs.readJson(BODOVI_FILE);
        let u = baza.korisnici.find(x => x.nadimak === socket.nadimak);

        if (upisano === tocan) {
            if (tacniOdgovoriUKrugu.includes(socket.nadimak)) return;
            tacniOdgovoriUKrugu.push(socket.nadimak);
            odgovorenoPuta++;
            
            let bodovi = (odgovorenoPuta === 1) ? 7 : 5;
            await azurirajBodove(socket.nadimak, bodovi, aktivna
                // KVIZ LOGIKA (TVOJA ORIGINALNA LOGIKA)
    socket.on('start_kviz', async (kat) => {
        try {
            const putanja = `./pitanja/${kat}.json`;
            const pitanja = await fs.readJson(putanja);
            aktivnaKategorija = kat;
            trenutnoPitanje = pitanja[Math.floor(Math.random() * pitanja.length)];
            odgovorenoPuta = 0;
            tacniOdgovoriUKrugu = [];
            io.emit('novo_pitanje', { pitanje: trenutnoPitanje.pitanje, kategorija: kat });
            pokreniTajmer();
        } catch (e) { socket.emit('obavijest', "Kategorija nema pitanja!"); }
    });

    socket.on('slanje_odgovora', async (odgovor) => {
        if (!trenutnoPitanje || !socket.nadimak) return;
        const tocan = trenutnoPitanje.odgovor.toLowerCase().trim();
        const upisano = odgovor.toLowerCase().trim();

        // Prikaz svima što je igrač odgovorio
        io.emit('chat_poruka', { igrac: socket.nadimak, tekst: upisano });

        const baza = await fs.readJson(BODOVI_FILE);
        let u = baza.korisnici.find(x => x.nadimak === socket.nadimak);

        if (upisano === tocan) {
            if (tacniOdgovoriUKrugu.includes(socket.nadimak)) return;
            tacniOdgovoriUKrugu.push(socket.nadimak);
            odgovorenoPuta++;
            
            let bodovi = (odgovorenoPuta === 1) ? 7 : 5;
            await azurirajBodove(socket.nadimak, bodovi, aktivnaKategorija);
            
            u.trenutniNiz = (u.trenutniNiz || 0) + 1;
            let pMsg = await provjeriPostignuca(u, 'niz');
            if (pMsg) io.emit('sustav_obavijest', pMsg);

            socket.emit('rezultat_odgovora', { točno: true, osvojeno: bodovi });
        } else {
            await azurirajBodove(socket.nadimak, -2, aktivnaKategorija);
            u.trenutniNiz = 0;
            socket.emit('rezultat_odgovora', { točno: false, osvojeno: -2 });
        }
        await fs.writeJson(BODOVI_FILE, baza);
    });

    socket.on('disconnect', () => {
        delete onlineKorisnici[socket.id];
        io.emit('update_online_list', Object.values(onlineKorisnici));
    });
}); // <--- ZATVARA io.on('connection')

function pokreniTajmer() {
    clearInterval(tajmerInterval);
    let sekunde = 30;
    tajmerInterval = setInterval(() => {
        io.emit('vrijeme', sekunde);
        if (sekunde <= 0) {
            clearInterval(tajmerInterval);
            io.emit('kraj_pitanja', { odgovor: trenutnoPitanje ? trenutnoPitanje.odgovor : "" });
            trenutnoPitanje = null;
        }
        sekunde--;
    }, 1000);
}

server.listen(3000, () => console.log("Arena radi na portu 3000"));