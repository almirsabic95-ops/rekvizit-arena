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
let tajmerInterval = null;
let aktivnaKategorija = "";
let tacniOdgovoriUKrugu = [];
let onlineKorisnici = {};

// Osiguraj bazu
if (!fs.existsSync(BODOVI_FILE)) {
    fs.writeJsonSync(BODOVI_FILE, { 
        korisnici: [], 
        zahtjevi_oporavak: [], 
        leaderboard: { dnevni: [], tjedni: [], ukupno: [] },
        kategorije_stats: {}
    });
}

// 1. SUSTAV POSTIGNUĆA I OBAVIJESTI
async function provjeriPostignuca(korisnik, tip) {
    let msg = null;
    if (!korisnik.postignuca) korisnik.postignuca = [];
    if (!korisnik.inventar) korisnik.inventar = [];

    if (tip === 'niz' && korisnik.trenutniNiz === 5 && !korisnik.postignuca.includes('vatra')) {
        korisnik.postignuca.push('vatra');
        msg = `🔥 SUSTAV: Igrač ${korisnik.nadimak} je pogodio 5 odgovora u nizu i dobio ikonicu VATRA!`;
    } else if (tip === 'niz' && korisnik.trenutniNiz === 10 && !korisnik.postignuca.includes('genijalac')) {
        korisnik.postignuca.push('genijalac');
        msg = `🧠 SPEKTAKL: ${korisnik.nadimak} ima niz od 10! Osvojen bedž GENIJALAC!`;
    } else if (tip === 'coinsi' && korisnik.coinsi >= 5000 && !korisnik.postignuca.includes('trgovac')) {
        korisnik.postignuca.push('trgovac');
        msg = `💰 TRGOVAC: ${korisnik.nadimak} je sakupio 5.000 coinsa i otključao posebnu karticu!`;
    } else if (tip === 'prvi' && !korisnik.postignuca.includes('munja')) {
        korisnik.postignuca.push('munja');
        msg = `⚡ MUNJA: ${korisnik.nadimak} je prvi put najbrže odgovorio i dobio ikonicu MUNJA!`;
    }
    return msg;
}

// 2. DNEVNI BONUS (7 dana niz)
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
io.on('connection', (socket) => {
    
    socket.on('prijava', async (podaci) => {
        const baza = await fs.readJson(BODOVI_FILE);
        let korisnik = baza.korisnici.find(u => u.nadimak === podaci.nadimak);

        // Provjera je li prva prijava
        if (!korisnik) {
            if (!podaci.lozinka || !podaci.tajna_sifra) {
                return socket.emit('registracija_potrebna', "Prva prijava! Unesi lozinku i tajnu šifru.");
            }
            korisnik = { 
                nadimak: podaci.nadimak, lozinka: podaci.lozinka, tajna_sifra: podaci.tajna_sifra,
                ukupni_bodovi: 0, coinsi: 500, nizLogina: 0, trenutniNiz: 0, 
                postignuca: [], zadnji_login: "", avatar: "default.png"
            };
            baza.korisnici.push(korisnik);
            await fs.writeJson(BODOVI_FILE, baza);
        }

        if (korisnik.lozinka !== podaci.lozinka) {
            return socket.emit('greska', "Pogrešna lozinka!");
        }

        const bonus = await provjeriDailyBonus(korisnik);
        await fs.writeJson(BODOVI_FILE, baza);

        socket.nadimak = korisnik.nadimak;
        onlineKorisnici[socket.id] = { id: socket.id, nadimak: korisnik.nadimak, bodovi: korisnik.ukupni_bodovi };
        
        socket.emit('prijavljen', { korisnik, bonus });
        io.emit('update_online_list', Object.values(onlineKorisnici));
    });

    // PRIVATNE PORUKE
    socket.on('privatna_poruka', (data) => {
        io.to(data.komeId).emit('primljena_privatna', {
            od: socket.nadimak,
            odId: socket.id,
            tekst: data.tekst
        });
    });

    // KVIZ I ODGOVORI
    socket.on('slanje_odgovora', async (odgovor) => {
        if (!trenutnoPitanje || !socket.nadimak) return;
        const tocan = trenutnoPitanje.odgovor.toLowerCase().trim();
        const upisano = odgovor.toLowerCase().trim();

        // Prikaz svih odgovora
        io.emit('chat_poruka', { igrac: socket.nadimak, tekst: upisano });

        const baza = await fs.readJson(BODOVI_FILE);
        let u = baza.korisnici.find(x => x.nadimak === socket.nadimak);

        if (upisano === tocan) {
            if (tacniOdgovoriUKrugu.includes(socket.nadimak)) return;
            tacniOdgovoriUKrugu.push(socket.nadimak);
            
            let brOnline = Object.keys(onlineKorisnici).length;
            let postotak = brOnline > 10 ? 0.6 : 0.5;
            let bodovi = (tacniOdgovoriUKrugu.length === 1) ? Math.floor(10 * postotak) : 3;

            u.ukupni_bodovi += bodovi;
            u.trenutniNiz++;
            
            let pMsg = await provjeriPostignuca(u, 'niz');
            if (pMsg) io.emit('sustav_obavijest', pMsg);
            
            socket.emit('rezultat_odgovora', { točno: true, osvojeno: bodovi });
        } else {
            u.ukupni_bodovi = Math.max(0, u.ukupni_bodovi - 2);
            u.trenutniNiz = 0;
            socket.emit('rezultat_odgovora', { točno: false, osvojeno: -2 });
        }
        await fs.writeJson(BODOVI_FILE, baza);
    });

    socket.on('posalji_oporavak', async (data) => {
        const baza = await fs.readJson(BODOVI_FILE);
        baza.zahtjevi_oporavak.push({ ...data, datum: new Date().toLocaleString() });
        await fs.writeJson(BODOVI_FILE, baza);
        socket.emit('info', "Zahtjev poslan adminu!");
    });

    socket.on('disconnect', () => {
        delete onlineKorisnici[socket.id];
        io.emit('update_online_list', Object.values(onlineKorisnici));
    });
});
socket.on('spin_wheel', async () => {
    const baza = await fs.readJson(BODOVI_FILE);
    let u = baza.korisnici.find(x => x.nadimak === socket.nadimak);
    if (u.coinsi < 50) return socket.emit('greska', "Nemaš dovoljno coinsa!");

    u.coinsi -= 50;
    const nagrade = [0, 20, 50, 100, 200, 500, 1000];
    const dobitak = nagrade[Math.floor(Math.random() * nagrade.length)];
    u.coinsi += dobitak;

    await fs.writeJson(BODOVI_FILE, baza);
    socket.emit('wheel_result', { dobitak, noviSaldo: u.coinsi });
    if(dobitak >= 500) io.emit('sustav_obavijest', `🎰 LUCKY! ${u.nadimak} je osvojio ${dobitak} na kolu sreće!`);
});

function pokreniTajmer() {
    let sekunde = 30;
    tajmerInterval = setInterval(() => {
        io.emit('vrijeme', sekunde);
        if (sekunde <= 0) clearInterval(tajmerInterval);
        sekunde--;
    }, 1000);
}

server.listen(3000, () => console.log("Arena na portu 3000"));