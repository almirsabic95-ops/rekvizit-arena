// MONGO DB CLOUD, SPREMANJE BODOVA

const mongoose = require('mongoose');

// Link za tvoju bazu (ubaci svoju lozinku umjesto <db_password>)
const MONGO_URI = "mongodb+srv://rekvizit:arenakviz@rekvizit.o6ugw5r.mongodb.net/RekvizitArena?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Uspješno povezan s Rekvizit Arena bazom!'))
    .catch(err => console.error('❌ Greška pri povezivanju:', err));

const KorisnikSchema = new mongoose.Schema({
    nadimak: { type: String, unique: true, required: true },
    lozinka: String,
    tajnaSifra: { type: String, default: "" },
    isPrvaPrijava: { type: Boolean, default: true },
    prihvatioPravila: { type: Boolean, default: false },
    coinsi: { type: Number, default: 100 },
    ukupni_bodovi: { type: Number, default: 0 },
    status: { type: String, default: 'aktivan' } // aktivan, shadowban
});

const Korisnik = mongoose.model('Korisnik', KorisnikSchema);

  // PROVJERA PRIJAVE, ZA PRVU PRIJAVU NUDI TAJNU ŠIFRU

  socket.on('pokusaj_prijave', async (data) => {
    try {
        const u = await Korisnik.findOne({ nadimak: data.nadimak, lozinka: data.lozinka });
        
        if (!u) {
            return socket.emit('login_greska', 'Pogrešan nadimak ili lozinka!');
        }

        if (u.isPrvaPrijava) {
            socket.emit('show_modal_tajna', u._id);
        } else if (!u.prihvatioPravila) {
            socket.emit('show_modal_pravila', u._id);
        } else {
            socket.nadimak = u.nadimak;
            socket.emit('prijavljen_uspjeh', u);
        }
    } catch (err) { console.error(err); }
});

// DOHVAĆANJE TABLICE IZ MONGO DB CLOUD (LIVE STATUS)

// Funkcija za slanje ažurirane ljestvice svima
async function emitirajLjestvice() {
    try {
        // 1. Dohvati TOP 10 iz MongoDB
        const topIgraci = await Korisnik.find({})
            .sort({ ukupni_bodovi: -1 })
            .limit(10)
            .select('nadimak ukupni_bodovi');

        // 2. Dohvati sve koji su trenutno spojeni na Socket.io
        const onlineNadimci = [];
        const sockets = await io.fetchSockets();
        sockets.forEach(s => {
            if (s.nadimak) onlineNadimci.push(s.nadimak);
        });

        // Pošalji svima
        io.emit('update_sideboard', {
            top: topIgraci,
            online: onlineNadimci
        });
    } catch (err) {
        console.error("Greška pri dohvatu ljestvice:", err);
    }
}

// Pozovi ovo čim se netko spoji ili prijavi
io.on('connection', (socket) => {
    socket.on('prijavljen_uspjeh', () => {
        emitirajLjestvice();
    });
    
    socket.on('disconnect', () => {
        emitirajLjestvice();
    });
});

// MODEL PROFILA U MONGO DB

// Ažuriraj svoj KorisnikSchema iz Bilješke 1 (dodaj ova polja)
const KorisnikSchema = new mongoose.Schema({
    // ... stara polja (nadimak, lozinka...)
    avatarUrl: { type: String, default: "default-avatar.png" },
    okvirUrl: { type: String, default: "basic-frame.png" },
    bedzevi: { type: Array, default: [] }, // npr. ["top1_januar", "veteran"]
    coinsi: { type: Number, default: 100 }
});

// GLOBALNI CHAT LOGIKA

io.on('connection', (socket) => {
    socket.on('chat_poruka_slanje', async (tekst) => {
        if (!socket.nadimak || tekst.trim() === "") return;

        // Pronalazimo igrača u MongoDB da uzmemo njegove bedževe za chat
        const u = await Korisnik.findOne({ nadimak: socket.nadimak });
        
        const podaciPoruke = {
            nadimak: socket.nadimak,
            tekst: tekst.substring(0, 200), // Ograničenje na 200 znakova
            bedzevi: u.bedzevi || [],
            vrijeme: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        io.emit('chat_poruka_prijem', podaciPoruke);
    });
});

// AUTOMATIZACIJA PITANJA I ODGOVORA (KVIZ)

let aktivnoPitanje = null;
let preostaloVrijeme = 30;
let tajmerId = null;

async function novoPitanje() {
    // Točka 10: Automatsko povlačenje (primjer iz MongoDB zbirke 'Pitanja')
    const pitanja = await mongoose.connection.db.collection('pitanja').find().toArray();
    aktivnoPitanje = pitanja[Math.floor(Math.random() * pitanja.length)];
    
    preostaloVrijeme = 30;
    io.emit('novo_pitanje_start', { pitanje: aktivnoPitanje.tekst });
    
    if (tajmerId) clearInterval(tajmerId);
    
    tajmerId = setInterval(() => {
        preostaloVrijeme--;
        io.emit('vrijeme_update', preostaloVrijeme);

        if (preostaloVrijeme <= 0) {
            clearInterval(tajmerId);
            io.emit('kraj_pitanja', { odgovor: aktivnoPitanje.odgovor });
            setTimeout(novoPitanje, 5000); // 5 sekundi pauze do novog pitanja
        }
    }, 1000);
}

// LOGIKA DVOBOJA I SOBA (1VS1)

let aktivniDueli = {};

socket.on('izazovi_igraca', (izazvaniNadimak) => {
    // Pronađi socket izazvanog igrača i pošalji mu upit
    const izazvaniSocket = pronađiSocketPoNadimku(izazvaniNadimak);
    if(izazvaniSocket) {
        izazvaniSocket.emit('dobio_izazov', { od: socket.nadimak });
    }
});

socket.on('prihvati_duel', (protivnikNadimak) => {
    const duelId = `duel_${Date.now()}`;
    socket.join(duelId);
    // Logika za pokretanje pitanja samo za taj duelId
    aktivniDueli[duelId] = { p1: socket.nadimak, p2: protivnikNadimak, hp1: 100, hp2: 100 };
    io.to(duelId).emit('duel_start', aktivniDueli[duelId]);
});

// LOGIKA KUPOVINE U TRGOVINI

// Primjer liste artikala u trgovini
const ARTIKLI = [
    { id: 'frame_gold', ime: 'Zlatni Okvir', cijena: 500, tip: 'okvir', src: 'gold-frame.png' },
    { id: 'badge_pro', ime: 'Pro Bedž', cijena: 1000, tip: 'bedz', src: 'pro-badge.png' },
    { id: 'avatar_viking', ime: 'Viking Avatar', cijena: 300, tip: 'avatar', src: 'viking.png' }
];

socket.on('kupi_artikl', async (artiklId) => {
    const artikl = ARTIKLI.find(a => a.id === artiklId);
    const u = await Korisnik.findOne({ nadimak: socket.nadimak });

    if (u.coinsi >= artikl.cijena) {
        // Skini coinse i dodaj u inventar
        u.coinsi -= artikl.cijena;
        
        if (artikl.tip === 'okvir') u.okvirUrl = artikl.src; // Odmah primjeni okvir
        if (artikl.tip === 'bedz') u.bedzevi.push(artikl.id);
        
        await u.save();
        
        socket.emit('kupovina_uspjesna', { 
            noviCoinsi: u.coinsi, 
            poruka: `Uspješno ste kupili ${artikl.ime}!` 
        });
        
        // CS 1.6 zvuk za kupovinu (npr. 'cha-ching')
        socket.emit('play_sound', 'buy.mp3');
    } else {
        socket.emit('kupovina_greska', 'Nemate dovoljno coinsa!');
    }
});

// LOGIKA PRIHVAĆANJA PRAVILA

socket.on('prihvati_pravila_final', async (userId) => {
    try {
        // Ažuriramo bazu
        const u = await Korisnik.findByIdAndUpdate(
            userId, 
            { prihvatioPravila: true }, 
            { new: true }
        );

        if (u) {
            socket.nadimak = u.nadimak;
            // Šaljemo signal klijentu da sakrije modal i otvori glavni izbornik
            socket.emit('pravila_prihvacena_uspjeh', u);
            console.log(`Igrač ${u.nadimak} je prihvatio pravila.`);
        }
    } catch (err) {
        console.error("Greška pri prihvaćanju pravila:", err);
    }
});

// LOGIKA IZVAČENJE NAGRADA U KOLU SREĆE

const NAGRADE = [
    { tekst: "50 Coinsa", tip: "coinsi", iznos: 50, deg: 1800 }, // 1800 = 5 krugova + 0
    { tekst: "100 Coinsa", tip: "coinsi", iznos: 100, deg: 1860 },
    { tekst: "Zlatni Okvir", tip: "okvir", iznos: "gold-frame.png", deg: 1920 },
    { tekst: "Bedž Sreće", tip: "bedz", iznos: "lucky_badge", deg: 1980 },
    { tekst: "5 Coinsa", tip: "coinsi", iznos: 5, deg: 2040 },
    { tekst: "200 Coinsa", tip: "coinsi", iznos: 200, deg: 2100 }
];

socket.on('zavrti_kolo', async () => {
    const u = await Korisnik.findOne({ nadimak: socket.nadimak });
    const danas = new Date().toDateString();

    if (u.zadnjiSpin === danas) {
        return socket.emit('kolo_greska', 'Već ste iskoristili današnji spin!');
    }

    const index = Math.floor(Math.random() * NAGRADE.length);
    const dobitak = NAGRADE[index];

    // Spremi u bazu
    u.zadnjiSpin = danas;
    if (dobitak.tip === "coinsi") u.coinsi += dobitak.iznos;
    if (dobitak.tip === "okvir") u.okvirUrl = dobitak.iznos;
    if (dobitak.tip === "bedz") u.bedzevi.push(dobitak.iznos);
    await u.save();

    socket.emit('kolo_rezultat', { stupnjevi: dobitak.deg, nagrada: dobitak.tekst });
});

// AUTOMATSKO UPRAVLJANJE PITANJIMA

// Funkcija koja se poziva svakih 35-40 sekundi
async function pokreniNoviKrug() {
    try {
        // 1. Povuci nasumično pitanje iz MongoDB
        const pitanjaKolekcija = mongoose.connection.db.collection('pitanja');
        const nasumicnoPitanje = await pitanjaKolekcija.aggregate([{ $sample: { size: 1 } }]).toArray();

        if (nasumicnoPitanje.length > 0) {
            trenutnoPitanje = nasumicnoPitanje[0];
            odgovorenoPuta = 0; // Resetiramo brojač točnih odgovora
            tacniOdgovoriUKrugu = []; // Lista ljudi koji su već pogodili

            // 2. Javi svima da kreće novo pitanje
            io.emit('novo_pitanje', { 
                tekst: trenutnoPitanje.pitanje, 
                kategorija: trenutnoPitanje.kategorija 
            });

            // 3. Pokreni tajmer (Stavka 13)
            pokreniOdbrojavanje();
        }
    } catch (err) {
        console.error("Greška pri povlačenju pitanja:", err);
    }
}

// SISTEM BODOVANJA I NIZOVA

socket.on('provjera_odgovora', async (upisaniOdgovor) => {
    if (!trenutnoPitanje || tacniOdgovoriUKrugu.includes(socket.nadimak)) return;

    const tocan = trenutnoPitanje.odgovor.toLowerCase().trim();
    const pokusaj = upisaniOdgovor.toLowerCase().trim();
    const u = await Korisnik.findOne({ nadimak: socket.nadimak });

    if (pokusaj === tocan) {
        tacniOdgovoriUKrugu.push(socket.nadimak);
        odgovorenoPuta++;

        // --- SISTEM BODOVANJA (Stavka 11) ---
        let osvojeniBodovi = (odgovorenoPuta === 1) ? 10 : 5; // Prvi dobiva 10, ostali 5
        let bonusCoinsi = (odgovorenoPuta === 1) ? 2 : 1;

        u.ukupni_bodovi += osvojeniBodovi;
        u.coinsi += bonusCoinsi;
        u.trenutniNiz += 1; // Povećaj streak

        await u.save();

        // Javi svima tko je pogodio (Stavka 14)
        io.emit('igrac_pogodio', { 
            nadimak: socket.nadimak, 
            bodovi: osvojeniBodovi, 
            niz: u.trenutniNiz 
        });

        // CS 1.6 Zvukovi (Stavka 20)
        if (u.trenutniNiz === 5) socket.emit('play_sound', 'multikill.mp3');
        else socket.emit('play_sound', 'headshot.mp3');

    } else {
        // --- KAZNA ZA POGREŠAN ODGOVOR ---
        u.ukupni_bodovi = Math.max(0, u.ukupni_bodovi - 2); // Oduzmi 2 boda
        u.trenutniNiz = 0; // Prekini niz
        await u.save();
        
        socket.emit('odgovor_netocan', { poruka: "Netočno! -2 boda", noviBodovi: u.ukupni_bodovi });
    }
});

// UPRAVLJANJE COINSIMA

// Funkcija za sigurnu dodjelu coinsa (npr. nakon kviza ili kola sreće)
async function dodajCoinse(nadimak, iznos) {
    try {
        const u = await Korisnik.findOne({ nadimak: nadimak });
        if (u) {
            u.coinsi += iznos;
            await u.save();
            // Javi klijentu da mu se stanje promijenilo
            const s = pronađiSocketPoNadimku(nadimak);
            if (s) s.emit('update_coins', u.coinsi);
        }
    } catch (err) { console.error("Greška coins:", err); }
}

// SHADOWBAN SISTEM

// U tvojoj KorisnikSchema dodaj polje: isShadowbanned: { type: Boolean, default: false }

socket.on('chat_poruka_slanje', async (tekst) => {
    const u = await Korisnik.findOne({ nadimak: socket.nadimak });
    
    if (u.isShadowbanned) {
        // Šaljemo poruku SAMO njemu nazad. On misli da je poslana svima.
        socket.emit('chat_poruka_prijem', {
            nadimak: socket.nadimak,
            tekst: tekst,
            vrijeme: "Sada",
            shadow: true 
        });
        return; // Zaustavljamo emitiranje ostalima
    }

    // Normalno emitiranje za ostale...
    io.emit('chat_poruka_prijem', { nadimak: socket.nadimak, tekst: tekst });
});

// Isto vrijedi i za kviz
socket.on('provjera_odgovora', async (odg) => {
    const u = await Korisnik.findOne({ nadimak: socket.nadimak });
    if (u.isShadowbanned) {
        // On uvijek dobije "Pogrešno" ili mu server jednostavno ne šalje potvrdu pogotka
        socket.emit('odgovor_netocan', { poruka: "Provjera u tijeku..." });
        return;
    }
    // Normalna logika provjere...
});

// DNEVNA PRIJAVA NIZ NAGRADA

// Dodaj polja u KorisnikSchema: loginStreak: {type: Number, default: 0}, zadnjiLogin: {type: Date}

async function provjeriDailyLogin(socket, korisnik) {
    const danas = new Date();
    danas.setHours(0, 0, 0, 0);

    const jucer = new Date(danas);
    jucer.setDate(jucer.getDate() - 1);

    const datumZadnjegLogina = korisnik.zadnjiLogin ? new Date(korisnik.zadnjiLogin) : null;
    if (datumZadnjegLogina) datumZadnjegLogina.setHours(0, 0, 0, 0);

    if (!datumZadnjegLogina || datumZadnjegLogina < danas) {
        if (datumZadnjegLogina && datumZadnjegLogina.getTime() === jucer.getTime()) {
            korisnik.loginStreak += 1; // Nastavlja niz
        } else {
            korisnik.loginStreak = 1; // Prekinut niz, kreće ispočetka
        }

        // Nagrada za 7. dan (Stavka 18)
        if (korisnik.loginStreak === 7) {
            korisnik.coinsi += 500;
            if (!korisnik.bedzevi.includes('vjernost_7')) {
                korisnik.bedzevi.push('vjernost_7');
            }
            socket.emit('specijalna_nagrada', 'Čestitamo! 7 dana zaredom u Areni! +500 Coinsa i Bedž Vjernosti!');
        }

        korisnik.zadnjiLogin = danas;
        await korisnik.save();
    }
    socket.emit('streak_update', korisnik.loginStreak);
}

// LISTA BEDŽEVA I OKVIRA ZA AVATAR

const DOSTUPNI_DODACI = {
    okviri: [
        { id: "basic", src: "basic-frame.png", naziv: "Početnički" },
        { id: "bronze", src: "bronze-frame.png", naziv: "Brončani" },
        { id: "gold", src: "gold-frame.png", naziv: "Zlatni" } // Stavka 19
    ],
    bedzevi: [
        { id: "vjernost_7", src: "7days.png", naziv: "Vjerni Igrač" },
        { id: "top1_januar", src: "trophy.png", naziv: "Šampion Siječnja" },
        { id: "rich", src: "money.png", naziv: "Milijunaš" }
    ]
};

// AUTORITIZACIJA ADMINA (ADMIN PANEL)

// U server.js dodaj listu admina
const ADMINI = ["TvojNadimak", "AdminDrug"];

socket.on('admin_zahtjev_podataka', async () => {
    if (!ADMINI.includes(socket.nadimak)) return;

    const svi = await Korisnik.find({}).sort({ nadimak: 1 });
    socket.emit('admin_podaci_odgovor', svi);
});

// Akcija: SHADOWBAN (Stavka 15)
socket.on('admin_shadowban', async (targetNadimak) => {
    if (!ADMINI.includes(socket.nadimak)) return;
    
    const u = await Korisnik.findOne({ nadimak: targetNadimak });
    u.isShadowbanned = !u.isShadowbanned; // Prekidač (On/Off)
    await u.save();
    
    // Osvježi admin listu kod tebe
    socket.emit('admin_obavijest', `Status shadowbana za ${targetNadimak} promijenjen.`);
});

// Akcija: DODAJ COINSE
socket.on('admin_dodaj_coinse', async (data) => {
    if (!ADMINI.includes(socket.nadimak)) return;
    
    await Korisnik.findOneAndUpdate(
        { nadimak: data.nadimak }, 
        { $inc: { coinsi: data.iznos } }
    );
    socket.emit('admin_obavijest', `Dano ${data.iznos} coinsa igraču ${data.nadimak}.`);
});

// ANTI CHEAT PROVJERA SERVERA

socket.on('provjera_odgovora', async (odgovor) => {
    // Ako server zna da je igrač "izletio" tijekom ovog pitanja
    if (socket.pitanjeBlokirano === trenutnoPitanje.id) {
        socket.emit('odgovor_netocan', { poruka: "Blokirani ste za ovo pitanje!" });
        return;
    }

    // Normalna provjera...
});

// Kad igrač javi da je tab postao 'hidden'
socket.on('log_sumnje', (razlog) => {
    socket.pitanjeBlokirano = trenutnoPitanje.id; // Blokiraj ga samo za trenutni ID
    console.log(`Igrač ${socket.nadimak} je blokiran za pitanje ${trenutniPitanje.id}`);
});

// LOGIKA PRIVATNIH PORUKA

socket.on('posalji_privatnu_poruku', (data) => {
    // data sadrži: { kome: 'Nadimak', tekst: 'Poruka...' }
    const primateljSocket = pronađiSocketPoNadimku(data.kome);
    
    if (primateljSocket) {
        const paket = {
            od: socket.nadimak,
            tekst: data.tekst,
            vrijeme: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        
        // Šaljemo primatelju
        primateljSocket.emit('prijem_privatne_poruke', paket);
        // Šaljemo pošiljatelju potvrdu da ispiše u svom prozoru
        socket.emit('potvrda_privatne_poruke', { kome: data.kome, tekst: data.tekst });
    }
});

// LOGIKA BODOVANJA U CLAN WARS

// server.js - Logika bodovanja u Clan Wars
socket.on('tacan_odgovor', async () => {
    if (socket.trenutnaSoba === 'clan_wars' && socket.klan) {
        // Tražimo statistiku igrača za taj konkretan klan
        let stats = await KlanStatistika.findOne({ 
            korisnikId: socket.userId, 
            klanIme: socket.klan 
        });
        
        if (!stats) {
            stats = new KlanStatistika({ korisnikId: socket.userId, klanIme: socket.klan, bodovi: 0 });
        }
        
        stats.bodovi += 10;
        await stats.save();
        
        // Ažuriramo ukupne bodove klana za ljestvicu
        await Klan.findOneAndUpdate({ ime: socket.klan }, { $inc: { ukupniBodovi: 10 } });
    }
});

// SERVERSKI MODOVI IZAZOVA

// --- MOD: IZAZOV PROFESORA ---
let profesorTajmer = null;
let trenutniProfesor = null;

socket.on('pokreni_izazov_profesora', (profesorNadimak) => {
    trenutniProfesor = profesorNadimak;
    io.emit('obavijest_profesor', `Profesor ${profesorNadimak} vas izaziva u Učilici! Imate 5 minuta!`);
    
    // Tajmer na 5 minuta (300000 ms)
    setTimeout(() => {
        zavrsiIzazovProfesora();
    }, 300000);
});

// --- MOD: IZNENADNA BORBA (Bivši Sudden Death) ---
let cooldownLista = new Map();

socket.on('provjera_titule_prijava', (user) => {
    const sada = Date.now();
    // Ako ima titulu i nije u hlađenju (2 sata = 7200000 ms)
    if (user.titula && (!cooldownLista.has(user.nadimak) || sada > cooldownLista.get(user.nadimak))) {
        
        socket.emit('start_iznenadna_borba'); // Javi igraču da krene mod
        
        // Postavi hlađenje od 2 sata nakon što mod završi
        setTimeout(() => {
            cooldownLista.set(user.nadimak, Date.now() + 7200000);
            socket.emit('kraj_iznenadne_borbe');
        }, 300000); // Traje 5 minuta
    }
});

// 