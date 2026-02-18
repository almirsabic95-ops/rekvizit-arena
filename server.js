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

// Osiguraj bazu podataka i sve potrebne tablice
if (!fs.existsSync(BODOVI_FILE)) {
    fs.writeJsonSync(BODOVI_FILE, { 
        korisnici: [], 
        zahtjevi_oporavak: [], 
        leaderboard: { dnevni: [], tjedni: [], mjesecni: [], ukupno: [] },
        kategorije_stats: {}
    });
}

// --- TVOJA ORIGINALNA FUNKCIJA ZA BODOVANJE (S ispravkom za mjezečni/mjesecni) ---
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

        const tipovi = ['dnevni', 'tjedni', 'mjesecni', 'ukupno'];
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
// --- SUSTAV POSTIGNUĆA ---
async function provjeriPostignuca(korisnik, tip) {
    let obavijest = null;
    if (!korisnik.postignuca) korisnik.postignuca = [];

    if (tip === 'niz' && korisnik.trenutniNiz === 5 && !korisnik.postignuca.includes('vatra')) {
        korisnik.postignuca.push('vatra');
        obavijest = `🔥 Igrač ${korisnik.nadimak} je pogodio 5 pitanja u nizu i dobio ikonicu VATRA!`;
    } else if (tip === 'niz' && korisnik.trenutniNiz === 10 && !korisnik.postignuca.includes('kruna')) {
        korisnik.postignuca.push('kruna');
        obavijest = `👑 KRALJ ARENE: ${korisnik.nadimak} je vezao 10 točnih odgovora!`;
    }
    return obavijest;
}

io.on('connection', (socket) => {
    
    socket.on('prijava', async (podaci) => {
        try {
            const baza = await fs.readJson(BODOVI_FILE);
            let korisnik = baza.korisnici.find(u => u.nadimak === podaci.nadimak);

            if (!korisnik) {
                korisnik = { 
                    nadimak: podaci.nadimak, lozinka: podaci.lozinka, tajna_sifra: podaci.tajna_sifra,
                    ukupni_bodovi: 0, coinsi: 500, trenutniNiz: 0, postignuca: []
                };
                baza.korisnici.push(korisnik);
                await fs.writeJson(BODOVI_FILE, baza);
            }

            socket.nadimak = korisnik.nadimak;
            onlineKorisnici[socket.id] = { id: socket.id, nadimak: korisnik.nadimak, bodovi: korisnik.ukupni_bodovi || 0 };
            
            socket.emit('prijavljen', { nadimak: korisnik.nadimak });
            io.emit('update_online_list', Object.values(onlineKorisnici));
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
        } catch (e) {
            socket.emit('obavijest', "Kategorija još nema pitanja!");
        }
    });

    socket.on('slanje_odgovora', async (odgovor) => {
        if (!trenutnoPitanje || !socket.nadimak) return;

        try {
            const tocan = trenutnoPitanje.odgovor.toLowerCase().trim();
            const upisano = odgovor.toLowerCase().trim();
            
            const baza = await fs.readJson(BODOVI_FILE);
            let u = baza.korisnici.find(x => x.nadimak === socket.nadimak);
            if (!u) return; // Osiguranje ako korisnik nije pronađen

            if (upisano === tocan) {
                if (tacniOdgovoriUKrugu.includes(socket.nadimak)) return;
                tacniOdgovoriUKrugu.push(socket.nadimak);
                odgovorenoPuta++;
                
                let bodovi = (odgovorenoPuta === 1) ? 7 : 5;
                
                // Prvo ažuriraj lokalni objekt korisnika
                u.trenutniNiz = (u.trenutniNiz || 0) + 1;
                
                // Pozovi funkciju za bodove (ona već sprema bazu unutar sebe)
                await azurirajBodove(socket.nadimak, bodovi, aktivnaKategorija);
                
                let pMsg = await provjeriPostignuca(u, 'niz');
                if (pMsg) io.emit('sustav_obavijest', pMsg);

                socket.emit('rezultat_odgovora', { točno: true, osvojeno: bodovi });
            } else {
                u.trenutniNiz = 0;
                await azurirajBodove(socket.nadimak, -2, aktivnaKategorija);
                socket.emit('rezultat_odgovora', { točno: false, osvojeno: -2 });
            }

            // Konačno spremanje promjena koje su napravljene na objektu 'u' (nizovi, postignuća)
            await fs.writeJson(BODOVI_FILE, baza, { spaces: 2 });

        } catch (error) {
            console.error("Greška pri obradi odgovora:", error);
        }
    });

    socket.on('disconnect', () => {
        delete onlineKorisnici[socket.id];
        io.emit('update_online_list', Object.values(onlineKorisnici));
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

server.listen(3000, () => console.log("Arena trči na portu 3000"));
<!DOCTYPE html>
<html lang="hr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rekvizit Arena - Kviz</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        :root { --main-bg: #121212; --accent: #007bff; --danger: #ff4d4d; --success: #28a745; }
        body { font-family: 'Segoe UI', sans-serif; background: var(--main-bg); color: white; text-align: center; margin: 0; padding: 20px; }
        .hidden { display: none; }
        .container { max-width: 600px; margin: 0 auto; background: #1e1e1e; padding: 20px; border-radius: 10px; border: 1px solid #333; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
        input { width: 90%; padding: 12px; margin: 10px 0; border-radius: 5px; border: 1px solid #444; background: #2a2a2a; color: white; font-size: 16px; }
        button { width: 95%; padding: 12px; margin: 5px 0; border-radius: 5px; border: none; font-size: 16px; font-weight: bold; cursor: pointer; background: var(--accent); color: white; transition: 0.3s; }
        button:hover { opacity: 0.8; }
        .grid-menu { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 20px; }
        #timer { font-size: 60px; font-weight: bold; margin: 10px 0; }
        .hitno { color: var(--danger); animation: blink 0.5s infinite; }
        @keyframes blink { 50% { opacity: 0.5; } }
        #feedback { font-size: 18px; font-weight: bold; margin-top: 15px; }
        .cisco-special { background: var(--success) !important; grid-column: span 2; }
    </style>
</head>
<body>

    <div id="login-screen" class="container">
        <h1>🏟️ Rekvizit Arena</h1>
        <p>Prijavi se ili registriraj</p>
        <input type="text" id="nick" placeholder="Nadimak" autocomplete="off">
        <input type="password" id="pass" placeholder="Lozinka">
        <input type="password" id="secret" placeholder="Tajna šifra (za oporavak)">
        <button onclick="prijaviSe()">UĐI U ARENU</button>
    </div>

    <div id="main-menu" class="container hidden">
        <h1>Glavni Izbornik</h1>
        <p>Dobrodošao, <span id="user-display" style="color: var(--accent);"></span>!</p>
        
        <div class="grid-menu">
            <button onclick="pokreniKviz('kultura')">🏛️ Kultura</button>
            <button onclick="pokreniKviz('znanost')">🧪 Znanost</button>
            <button onclick="pokreniKviz('sport')">⚽ Sport</button>
            <button onclick="pokreniKviz('povijest')">📜 Povijest</button>
            <button onclick="pokreniKviz('zemljopis')">🌍 Zemljopis</button>
            <button onclick="pokreniKviz('glazba')">🎵 Glazba</button>
            <button onclick="pokreniKviz('film')">🎬 Film</button>
            <button onclick="pokreniKviz('mix')">🎲 MIX</button>
            <button id="cisco-btn" class="hidden cisco-special" onclick="pokreniKviz('cisco')">🌐 Cisco Academy</button>
        </div>

        <hr style="margin: 20px 0; border: 0; border-top: 1px solid #333;">
        <h3>📊 Leaderboard</h3>
        <div id="online-list-box" style="font-size: 12px; margin-top: 10px; text-align: left; padding: 10px; background: #111; border-radius: 5px;">
            <strong>Online:</strong> <span id="online-list-names">Učitavanje...</span>
        </div>
    </div>

    <div id="quiz-screen" class="container hidden">
        <div id="timer">30</div>
        <h2 id="pitanje-tekst">Učitavanje...</h2>
        <input type="text" id="odgovor-input" placeholder="Upiši odgovor i stisni Enter..." autocomplete="off">
        <button id="posalji-btn" onclick="posaljiOdgovor()">POŠALJI</button>
        <p id="feedback"></p>
        <button onclick="povratakUMenu()" style="background: #444; margin-top: 20px;">Odustani</button>
    </div>

    <script>
        const socket = io();

        function prijaviSe() {
            const nick = document.getElementById('nick').value;
            const pass = document.getElementById('pass').value;
            const secret = document.getElementById('secret').value;
            if(!nick || !pass || !secret) return alert("Popuni sva polja!");
            socket.emit('prijava', { nadimak: nick, lozinka: pass, tajna_sifra: secret });
        }

        socket.on('prijavljen', (res) => {
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('main-menu').classList.remove('hidden');
            document.getElementById('user-display').innerText = res.nadimak;
            if (res.nadimak.toLowerCase() === 'blanco') document.getElementById('cisco-btn').classList.remove('hidden');
        });

        function pokreniKviz(kat) {
            document.getElementById('main-menu').classList.add('hidden');
            document.getElementById('quiz-screen').classList.remove('hidden');
            socket.emit('start_kviz', kat);
        }

        function posaljiOdgovor() {
            const input = document.getElementById('odgovor-input');
            if (input.value.trim() !== "") {
                socket.emit('slanje_odgovora', input.value);
                input.disabled = true;
                document.getElementById('posalji-btn').disabled = true;
            }
        }

        document.getElementById('odgovor-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') posaljiOdgovor();
        });

        socket.on('novo_pitanje', (data) => {
            document.getElementById('pitanje-tekst').innerText = data.pitanje;
            const input = document.getElementById('odgovor-input');
            input.value = ""; input.disabled = false; input.focus();
            document.getElementById('posalji-btn').disabled = false;
            document.getElementById('feedback').innerText = "";
        });

        socket.on('vrijeme', (s) => {
            const t = document.getElementById('timer');
            t.innerText = s;
            t.className = (s <= 10) ? 'hitno' : '';
        });

        socket.on('update_online_list', (users) => {
            document.getElementById('online-list-names').innerText = users.map(u => u.nadimak).join(', ');
        });

        socket.on('rezultat_odgovora', (res) => {
            const f = document.getElementById('feedback');
            if (res.točno) {
                f.innerText = `TOČNO! +${res.osvojeno} bodova`;
                f.style.color = "var(--success)";
            } else {
                f.innerText = `NETOČNO! -2 boda`;
                f.style.color = "var(--danger)";
            }
        });

        socket.on('sustav_obavijest', (msg) => alert(msg));
        function povratakUMenu() { document.getElementById('quiz-screen').classList.add('hidden'); document.getElementById('main-menu').classList.remove('hidden'); }
    </script>
</body>
</html>