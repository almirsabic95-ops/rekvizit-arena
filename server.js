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
let onlineKorisnici = {}; // ID socket-a -> podaci o korisniku

// Osiguraj da bodovi.json postoji
if (!fs.existsSync(BODOVI_FILE)) {
    fs.writeJsonSync(BODOVI_FILE, { korisnici: [], leaderboard: { dnevni: [], tjedni: [], mjesecni: [], ukupno: [] }, kategorije_stats: {} });
}

// Funkcija za miješanje pitanja (da se ne ponavljaju istih 5)
function dajNasumicnoPitanje(pitanja) {
    return pitanja[Math.floor(Math.random() * pitanja.length)];
}
io.on('connection', (socket) => {
    
    socket.on('prijava', async (podaci) => {
        const baza = await fs.readJson(BODOVI_FILE);
        let korisnik = baza.korisnici.find(u => u.nadimak === podaci.nadimak);

        if (!korisnik) {
            korisnik = { 
                nadimak: podaci.nadimak, lozinka: podaci.lozinka, tajna_sifra: podaci.tajna_sifra, 
                ukupni_bodovi: 0, avatar: "default.png", bedzevi: [] 
            };
            baza.korisnici.push(korisnik);
            await fs.writeJson(BODOVI_FILE, baza);
        }

        socket.nadimak = korisnik.nadimak;
        onlineKorisnici[socket.id] = { 
            id: socket.id, 
            nadimak: korisnik.nadimak, 
            bodovi: korisnik.ukupni_bodovi,
            avatar: korisnik.avatar 
        };

        socket.emit('prijavljen', korisnik);
        io.emit('update_online_list', Object.values(onlineKorisnici));
    });

    // PRIVATNE PORUKE (Ne spremaju se u bazu)
    socket.on('privatna_poruka', (data) => {
        // data sadrži: { komeId: "socket_id_primatelja", tekst: "poruka" }
        const posiljatelj = socket.nadimak;
        io.to(data.komeId).emit('primljena_privatna', {
            od: posiljatelj,
            odId: socket.id,
            tekst: data.tekst
        });
    });

    socket.on('disconnect', () => {
        delete onlineKorisnici[socket.id];
        io.emit('update_online_list', Object.values(onlineKorisnici));
    });
    socket.on('start_kviz', async (kat) => {
        try {
            const putanja = `./pitanja/${kat}.json`;
            const pitanja = await fs.readJson(putanja);
            aktivnaKategorija = kat;
            trenutnoPitanje = dajNasumicnoPitanje(pitanja);
            odgovorenoPuta = 0;
            tacniOdgovoriUKrugu = [];
            
            io.emit('novo_pitanje', { pitanje: trenutnoPitanje.pitanje, kategorija: kat });
            pokreniTajmer();
        } catch (e) {
            socket.emit('obavijest', "Kategorija nema pitanja!");
        }
    });

    socket.on('slanje_odgovora', async (odgovor) => {
        if (!trenutnoPitanje || !socket.nadimak) return;

        const tocan = trenutnoPitanje.odgovor.toLowerCase().trim();
        const upisano = odgovor.toLowerCase().trim();

        // Prikaz svih odgovora u globalnom chatu (tvoj zahtjev)
        io.emit('globalni_odgovor_prikaz', { igrac: socket.nadimak, tekst: upisano });

        if (upisano === tocan) {
            if (tacniOdgovoriUKrugu.includes(socket.nadimak)) return;
            
            tacniOdgovoriUKrugu.push(socket.nadimak);
            odgovorenoPuta++;
            
            // Prvi dobiva 7, ostali 5 (ili tvoj postotak ovisno o broju igrača)
            let bodovi = (odgovorenoPuta === 1) ? 7 : 5;
            await azurirajBodove(socket.nadimak, bodovi, aktivnaKategorija);
            
            socket.emit('rezultat_odgovora', { točno: true, osvojeno: bodovi });
        } else {
            await azurirajBodove(socket.nadimak, -2, aktivnaKategorija);
            socket.emit('rezultat_odgovora', { točno: false, osvojeno: -2 });
        }
    });
}); // Zatvara io.on('connection')

function pokreniTajmer() {
    clearInterval(tajmerInterval);
    let sekunde = 30;
    tajmerInterval = setInterval(() => {
        io.emit('vrijeme', sekunde);
        if (sekunde <= 0) {
            clearInterval(tajmerInterval);
            trenutnoPitanje = null;
        }
        sekunde--;
    }, 1000);
}

// Funkcija azurirajBodove ostaje ista kao u tvojoj datoteci, 
// samo pazi da je unutar server.js ali izvan socket logike.

server.listen(3000, () => console.log("Arena trči na portu 3000"));