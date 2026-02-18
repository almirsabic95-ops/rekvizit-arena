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

// --- FUNKCIJA ZA BODOVANJE (Sve kategorije i leaderboardi) ---
async function azurirajBodove(nadimak, osvojeniBodovi, kategorija) {
    try {
        const baza = await fs.readJson(BODOVI_FILE);
        let korisnik = baza.korisnici.find(u => u.nadimak === nadimak);
        if (korisnik) {
            if (!korisnik.ukupni_bodovi) korisnik.ukupni_bodovi = 0;
            korisnik.ukupni_bodovi += osvojeniBodovi;
        }

        if (!baza.kategorije_stats[kategorija]) baza.kategorije_stats[kategorija] = [];
        let katStat = baza.kategorije_stats[kategorija].find(s => s.nadimak === nadimak);
        if (!katStat) {
            baza.kategorije_stats[kategorija].push({ nadimak: nadimak, bodovi: osvojeniBodovi });
        } else {
            katStat.bodovi += osvojeniBodovi;
        }

        const tipovi = ['dnevni', 'tjedni', 'mjesecni', 'ukupno'];
        tipovi.forEach(tip => {
            if (!baza.leaderboard[tip]) baza.leaderboard[tip] = [];
            let lb = baza.leaderboard[tip].find(l => l.nadimak === nadimak);
            if (!lb) {
                baza.leaderboard[tip].push({ nadimak: nadimak, bodovi: osvojeniBodovi });
            } else {
                lb.bodovi += osvojeniBodovi;
            }
            baza.leaderboard[tip].sort((a, b) => b.bodovi - a.bodovi);
        });

        await fs.writeJson(BODOVI_FILE, baza, { spaces: 2 });
    } catch (err) { console.error("Greška bodovanja:", err); }
}

async function provjeriPostignuca(korisnik, tip) {
    if (!korisnik.postignuca) korisnik.postignuca = [];
    if (tip === 'niz' && korisnik.trenutniNiz === 5 && !korisnik.postignuca.includes('vatra')) {
        korisnik.postignuca.push('vatra');
        return `🔥 Igrač ${korisnik.nadimak} je dobio VATRU (5 u nizu)!`;
    }
    return null;
}
io.on('connection', (socket) => {
    socket.on('prijava', async (podaci) => {
        try {
            const baza = await fs.readJson(BODOVI_FILE);
            let korisnik = baza.korisnici.find(u => u.nadimak === podaci.nadimak);
            if (!korisnik) {
                korisnik = { 
                    nadimak: podaci.nadimak, lozinka: podaci.lozinka, tajna_sifra: podaci.tajna_sifra, 
                    opomene: 0, banovanDo: null, ukupni_bodovi: 0, postignuca: [], trenutniNiz: 0 
                };
                baza.korisnici.push(korisnik);
                await fs.writeJson(BODOVI_FILE, baza);
            }
            if (korisnik.banovanDo && korisnik.banovanDo > Date.now()) {
                socket.emit('ban_info', `Banovani ste do ${new Date(korisnik.banovanDo).toLocaleString()}`);
                return;
            }
            socket.nadimak = korisnik.nadimak;
            socket.emit('prijavljen', { nadimak: korisnik.nadimak });
        } catch (e) { console.error(e); }
    });

    socket.on('start_kviz', async (kat) => {
        try {
            const putanja = `./pitanja/${kat}.json`;
            const pitanja = await fs.readJson(putanja);
            aktivnaKategorija = kat;
            trenutnoPitanje = pitanja[Math.floor(Math.random() * pitanja.length)];
            odgovorenoPuta = 0;
            tacniOdgovoriUKrugu = [];
            io.emit('novo_pitanje', { pitanje: trenutnoPitanje.pitanje });
            pokreniTajmer();
        } catch (e) { socket.emit('obavijest', "Kategorija još nema pitanja!"); }
    });

    socket.on('slanje_odgovora', async (odgovor) => {
        if (!trenutnoPitanje || !socket.nadimak) return;
        try {
            const tocan = trenutnoPitanje.odgovor.toLowerCase().trim();
            const upisano = odgovor.toLowerCase().trim();
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
            await fs.writeJson(BODOVI_FILE, baza, { spaces: 2 });
        } catch (err) { console.error(err); }
    });
});

function pokreniTajmer() {
    clearInterval(tajmerInterval);
    let sekunde = 30;
    tajmerInterval = setInterval(() => {
        io.emit('vrijeme', sekunde);
        if (sekunde-- <= 0) {
            clearInterval(tajmerInterval);
            io.emit('kraj_pitanja');
            trenutnoPitanje = null;
        }
    }, 1000);
}

server.listen(3000, () => console.log("Arena trči na portu 3000"));